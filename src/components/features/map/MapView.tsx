import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, {
  type SourceSpecification,
  type LayerSpecification,
  type FilterSpecification,
  type ExpressionSpecification,
  MapMouseEvent,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import { createRoot } from 'react-dom/client';
import { cn } from '@/lib/utils';
import { makeFeatureKey, useAppStore, type LayerGroupId } from '@/state/store';
import { FeaturePopup, type PopupInfo } from './FeaturePopup';
import { FeatureDetailModal } from './FeatureDetailModal';
// import { MapSearch } from './MapSearch'; // Removed

let mapInstance: maplibregl.Map | null = null;

const protocol = (() => {
  const globalScope = globalThis as typeof globalThis & { __pmtilesProtocol?: Protocol };

  if (!globalScope.__pmtilesProtocol) {
    const instance = new Protocol();
    maplibregl.addProtocol('pmtiles', instance.tile.bind(instance));
    globalScope.__pmtilesProtocol = instance;
  }

  return globalScope.__pmtilesProtocol;
})();

const POWER_SOURCE_ID = 'power';
const POWER_LABEL_SOURCE_ID = 'power-labels';
const POWER_LABEL_LAYER_PREFIX = 'pwr-label-';
const BASEMAP_SOURCE_ID = 'basemap-light';
const BASEMAP_LAYER_ID = 'basemap-light';

const registerPmtilesArchive = (url: string) => {
  const archive = new PMTiles(url);
  protocol.add(archive);
  return archive;
};

const ensureBasemap = (map: maplibregl.Map) => {
  if (!map.getSource(BASEMAP_SOURCE_ID)) {
    map.addSource(BASEMAP_SOURCE_ID, {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    });
  }

  if (!map.getLayer(BASEMAP_LAYER_ID)) {
    map.addLayer({
      id: BASEMAP_LAYER_ID,
      type: 'raster',
      source: BASEMAP_SOURCE_ID,
      minzoom: 0,
      maxzoom: 19,
    });
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractVectorLayerIds = (metadata: unknown): Set<string> => {
  const layerIds = new Set<string>();
  if (!isPlainObject(metadata)) {
    return layerIds;
  }

  const directLayers = metadata['vector_layers'];
  if (Array.isArray(directLayers)) {
    directLayers.forEach((layer) => {
      if (isPlainObject(layer)) {
        const id = layer['id'];
        if (typeof id === 'string') {
          layerIds.add(id);
        }
      }
    });
  }

  const jsonValue = metadata['json'];
  if (typeof jsonValue === 'string') {
    try {
      const parsed = JSON.parse(jsonValue);
      if (isPlainObject(parsed) && Array.isArray(parsed['vector_layers'])) {
        parsed['vector_layers'].forEach((layer) => {
          if (isPlainObject(layer)) {
            const id = layer['id'];
            if (typeof id === 'string') {
              layerIds.add(id);
            }
          }
        });
      }
    } catch (error) {
      console.warn('[MapView] unable to parse metadata.json', error);
    }
  }

  return layerIds;
};

type Category =
  | 'lines'
  | 'minor_lines'
  | 'cables'
  | 'plants'
  | 'generators'
  | 'substations'
  | 'towers'
  | 'poles'
  | 'switches'
  | 'transformers'
  | 'compensators'
  | 'converters';

interface LayerVariant {
  geometry: 'line' | 'fill' | 'circle';
  paint: LayerSpecification['paint'];
  layout?: LayerSpecification['layout'];
  minzoom?: number;
  maxzoom?: number;
  filter?: FilterSpecification;
  idSuffix?: string;
}

interface CategoryStyle {
  sourceLayer: string;
  baseMinzoom?: number;
  zIndex: number;
  variants: LayerVariant[];
}





const circleStroke = '#ffffff';
const HIGH_VOLTAGE_SUFFIXES = new Set(['-275kv', '-132kv']);
const LOW_VOLTAGE_SUFFIXES = new Set(['-66kv', '-33kv', '-11kv', '-lv', '-other']);

const resolveLayerGroup = (
  category: Category,
  variantSuffix?: string | null,
): LayerGroupId | null => {
  switch (category) {
    case 'plants':
      return 'powerPlants';
    case 'generators':
      return 'powerGenerators';
    case 'substations':
    case 'compensators':
    case 'converters':
      return 'substations';
    case 'transformers':
      return 'transformers';
    case 'switches':
      return 'switchgear';
    case 'cables':
      return 'cables';
    case 'towers':
      return 'transmission';
    case 'poles':
      return 'distribution';
    case 'lines':
    case 'minor_lines': {
      const suffix = variantSuffix ?? '';
      if (HIGH_VOLTAGE_SUFFIXES.has(suffix)) {
        return 'transmission';
      }
      if (LOW_VOLTAGE_SUFFIXES.has(suffix)) {
        return 'distribution';
      }
      return 'transmission';
    }
    default:
      return null;
  }
};

const RAW_VOLTAGE_EXPR: ExpressionSpecification = [
  'coalesce',
  ['get', 'voltage_kv'],
  ['get', 'voltage'],
  -1,
];

// Handle cases where voltage is a string array like "[132,66]"
// We try to extract the first value if it's an array string
const PARSED_VOLTAGE_EXPR: ExpressionSpecification = [
  'case',
  // If it's a string starting with '['
  [
    'all',
    ['==', ['typeof', RAW_VOLTAGE_EXPR], 'string'],
    ['==', ['slice', RAW_VOLTAGE_EXPR, 0, 1], '['],
  ],
  [
    'let',
    'comma_index',
    ['index-of', ',', RAW_VOLTAGE_EXPR],
    [
      'to-number',
      [
        'case',
        ['>', ['var', 'comma_index'], -1],
        ['slice', RAW_VOLTAGE_EXPR, 1, ['var', 'comma_index']], // Take up to first comma
        ['slice', RAW_VOLTAGE_EXPR, 1, ['-', ['length', RAW_VOLTAGE_EXPR], 1]], // Take up to end ']'
      ],
    ],
  ],
  // Fallback: try to convert directly
  ['to-number', RAW_VOLTAGE_EXPR],
];

// Filter out unrealistic voltages (e.g. > 1200kV)
const VOLTAGE_EXPR: ExpressionSpecification = [
  'case',
  ['>', PARSED_VOLTAGE_EXPR, 1200],
  -1,
  PARSED_VOLTAGE_EXPR,
];
const GENERATOR_SOURCE_EXPR: ExpressionSpecification = [
  'downcase',
  ['coalesce', ['get', 'generator:source'], ['get', 'generator:type'], ['get', 'source'], ''],
];

const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  lines: {
    sourceLayer: 'lines',
    baseMinzoom: 0,
    zIndex: 30,
    variants: [
      {
        idSuffix: '-275kv',
        geometry: 'line',
        minzoom: 5,
        filter: ['>=', VOLTAGE_EXPR, 275],
        paint: {
          'line-color': '#ff002bff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 14, 3],
          'line-opacity': 0.9,
        },
      },
      {
        idSuffix: '-132kv',
        geometry: 'line',
        minzoom: 6,
        filter: ['all', ['>=', VOLTAGE_EXPR, 132], ['<', VOLTAGE_EXPR, 275]],
        paint: {
          'line-color': '#2f5f94',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 14, 3],
          'line-opacity': 0.82,
        },
      },
      {
        idSuffix: '-66kv',
        geometry: 'line',
        minzoom: 7,
        filter: ['all', ['>=', VOLTAGE_EXPR, 66], ['<', VOLTAGE_EXPR, 132]],
        paint: {
          'line-color': '#b83faeff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 3],
          'line-opacity': 0.75,
        },
      },
      {
        idSuffix: '-33kv',
        geometry: 'line',
        minzoom: 8,
        filter: ['all', ['>=', VOLTAGE_EXPR, 33], ['<', VOLTAGE_EXPR, 66]],
        paint: {
          'line-color': '#51df70ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3],
          'line-opacity': 0.7,
        },
      },
      {
        idSuffix: '-11kv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 11], ['<', VOLTAGE_EXPR, 33]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.6,
        },
      },
      {
        idSuffix: '-lv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 0], ['<', VOLTAGE_EXPR, 11]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.55,
        },
      },
      {
        idSuffix: '-other',
        geometry: 'line',
        minzoom: 10,
        filter: ['==', VOLTAGE_EXPR, -1],
        paint: {
          'line-color': '#b69bffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.65,
        },
      },
    ],
  },
  minor_lines: {
    sourceLayer: 'minor_lines',
    baseMinzoom: 4,
    zIndex: 25,
    variants: [
      {
        idSuffix: '-275kv',
        geometry: 'line',
        minzoom: 5,
        filter: ['>=', VOLTAGE_EXPR, 275],
        paint: {
          'line-color': '#ff002bff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 14, 3],
          'line-opacity': 0.9,
        },
      },
      {
        idSuffix: '-132kv',
        geometry: 'line',
        minzoom: 6,
        filter: ['all', ['>=', VOLTAGE_EXPR, 132], ['<', VOLTAGE_EXPR, 275]],
        paint: {
          'line-color': '#2f5f94',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 3],
          'line-opacity': 0.82,
        },
      },
      {
        idSuffix: '-66kv',
        geometry: 'line',
        minzoom: 7,
        filter: ['all', ['>=', VOLTAGE_EXPR, 66], ['<', VOLTAGE_EXPR, 132]],
        paint: {
          'line-color': '#b83faeff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 3],
          'line-opacity': 0.75,
        },
      },
      {
        idSuffix: '-33kv',
        geometry: 'line',
        minzoom: 8,
        filter: ['all', ['>=', VOLTAGE_EXPR, 33], ['<', VOLTAGE_EXPR, 66]],
        paint: {
          'line-color': '#51df70ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 3],
          'line-opacity': 0.7,
        },
      },
      {
        idSuffix: '-11kv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 11], ['<', VOLTAGE_EXPR, 33]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.6,
        },
      },
      {
        idSuffix: '-lv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 0], ['<', VOLTAGE_EXPR, 11]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.55,
        },
      },
      {
        idSuffix: '-other',
        geometry: 'line',
        minzoom: 10,
        filter: ['==', VOLTAGE_EXPR, -1],
        paint: {
          'line-color': '#b69bffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-opacity': 0.65,
        },
      },
    ],
  },
  cables: {
    sourceLayer: 'cables',
    baseMinzoom: 0,
    zIndex: 28,
    variants: [
      {
        idSuffix: '-275kv',
        geometry: 'line',
        minzoom: 5,
        filter: ['>=', VOLTAGE_EXPR, 275],
        paint: {
          'line-color': '#ff002bff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.9,
        },
      },
      {
        idSuffix: '-132kv',
        geometry: 'line',
        minzoom: 6,
        filter: ['all', ['>=', VOLTAGE_EXPR, 132], ['<', VOLTAGE_EXPR, 275]],
        paint: {
          'line-color': '#2f5f94',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.82,
        },
      },
      {
        idSuffix: '-66kv',
        geometry: 'line',
        minzoom: 7,
        filter: ['all', ['>=', VOLTAGE_EXPR, 66], ['<', VOLTAGE_EXPR, 132]],
        paint: {
          'line-color': '#b83faeff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.75,
        },
      },
      {
        idSuffix: '-33kv',
        geometry: 'line',
        minzoom: 8,
        filter: ['all', ['>=', VOLTAGE_EXPR, 33], ['<', VOLTAGE_EXPR, 66]],
        paint: {
          'line-color': '#51df70ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.7,
        },
      },
      {
        idSuffix: '-11kv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 11], ['<', VOLTAGE_EXPR, 33]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.6,
        },
      },
      {
        idSuffix: '-lv',
        geometry: 'line',
        minzoom: 10,
        filter: ['all', ['>=', VOLTAGE_EXPR, 0], ['<', VOLTAGE_EXPR, 11]],
        paint: {
          'line-color': '#00e1ffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.55,
        },
      },
      {
        idSuffix: '-other',
        geometry: 'line',
        minzoom: 10,
        filter: ['==', VOLTAGE_EXPR, -1],
        paint: {
          'line-color': '#f500d4ff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 3],
          'line-dasharray': [1.2, 1.2],
          'line-opacity': 0.65,
        },
      },
    ],
  },
  plants: {
    sourceLayer: 'plants',
    baseMinzoom: 6,
    zIndex: 20,
    variants: [
      {
        idSuffix: '-solar-poly',
        geometry: 'fill',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
          ['==', ['downcase', ['coalesce', ['get', 'plant:source'], '']], 'solar'],
        ],
        paint: {
          'fill-color': '#f9e4b7',
          'fill-outline-color': '#e0b95f',
          'fill-opacity': 0.7,
        },
      },
      {
        idSuffix: '-solar-pt',
        geometry: 'circle',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          ['==', ['downcase', ['coalesce', ['get', 'plant:source'], '']], 'solar'],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.6, 12, 5],
          'circle-color': '#f2c76b',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1,
        },
      },
      {
        idSuffix: '-wind-poly',
        geometry: 'fill',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
          ['==', ['downcase', ['coalesce', ['get', 'plant:source'], '']], 'wind'],
        ],
        paint: {
          'fill-color': '#75ec75ff',
          'fill-outline-color': '#b7f3d2ff',
          'fill-opacity': 0.7,
        },
      },
      {
        idSuffix: '-wind-pt',
        geometry: 'circle',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          ['==', ['downcase', ['coalesce', ['get', 'plant:source'], '']], 'wind'],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 12, 4.8],
          'circle-color': '#7aaed6',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1,
        },
      },
      {
        idSuffix: '-other-poly',
        geometry: 'fill',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
          [
            '!',
            [
              'in',
              ['downcase', ['coalesce', ['get', 'plant:source'], '']],
              ['literal', ['solar', 'wind']],
            ],
          ],
        ],
        paint: {
          'fill-color': '#d9dfec',
          'fill-outline-color': '#9aa6bf',
          'fill-opacity': 0.55,
        },
      },
      {
        idSuffix: '-other-pt',
        geometry: 'circle',
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          [
            '!',
            [
              'in',
              ['downcase', ['coalesce', ['get', 'plant:source'], '']],
              ['literal', ['solar', 'wind']],
            ],
          ],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.2, 12, 4.2],
          'circle-color': '#aebad1',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 0.9,
        },
      },
    ],
  },
  substations: {
    sourceLayer: 'substations',
    baseMinzoom: 6,
    zIndex: 22,
    variants: [
      {
        geometry: 'fill',
        paint: {
          'fill-color': '#a5abe6ff',
          'fill-outline-color': '#d3b8cbff',
          'fill-opacity': 0.7,
        },
      },
    ],
  },
  generators: {
    sourceLayer: 'generators',
    baseMinzoom: 7,
    zIndex: 40,
    variants: [
      {
        idSuffix: '-poly',
        geometry: 'fill',
        filter: [
          'any',
          ['==', ['geometry-type'], 'Polygon'],
          ['==', ['geometry-type'], 'MultiPolygon'],
        ],
        paint: {
          'fill-color': '#fce1de',
          'fill-outline-color': '#f25f5c',
          'fill-opacity': 0.75,
        },
      },
      {
        idSuffix: '-solar-pt',
        geometry: 'circle',
        minzoom: 15,
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          ['==', GENERATOR_SOURCE_EXPR, 'solar'],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6],
          'circle-color': '#f2c76b',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1.2,
        },
      },
      {
        idSuffix: '-wind-pt',
        geometry: 'circle',
        minzoom: 9,
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          ['==', GENERATOR_SOURCE_EXPR, 'wind'],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 5],
          'circle-color': '#7aaed6',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1.2,
        },
      },
      {
        idSuffix: '-other-pt',
        geometry: 'circle',
        minzoom: 12,
        filter: [
          'all',
          ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          ['!', ['in', GENERATOR_SOURCE_EXPR, ['literal', ['solar', 'wind']]]],
        ],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 6],
          'circle-color': '#f25f5c',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1.2,
        },
      },
    ],
  },
  converters: {
    sourceLayer: 'converters',
    baseMinzoom: 8,
    zIndex: 38,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.4, 13, 5],
          'circle-color': '#5a7ce2',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1,
        },
      },
    ],
  },
  compensators: {
    sourceLayer: 'compensators',
    baseMinzoom: 10,
    zIndex: 36,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5],
          'circle-color': '#79a8ff',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1,
        },
      },
    ],
  },
  transformers: {
    sourceLayer: 'transformers',
    baseMinzoom: 10,
    zIndex: 35,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5],
          'circle-color': '#f7a84f',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 1,
        },
      },
    ],
  },
  switches: {
    sourceLayer: 'switches',
    baseMinzoom: 11,
    zIndex: 34,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 15, 3.6],
          'circle-color': '#9fb3c8',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 0.8,
        },
      },
    ],
  },
  towers: {
    sourceLayer: 'towers',
    baseMinzoom: 12,
    zIndex: 32,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 3.2],
          'circle-color': '#5d6d7e',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 0.9,
        },
      },
    ],
  },
  poles: {
    sourceLayer: 'poles',
    baseMinzoom: 15,
    zIndex: 31,
    variants: [
      {
        geometry: 'circle',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 16, 2.6],
          'circle-color': '#a2b1c3',
          'circle-stroke-color': circleStroke,
          'circle-stroke-width': 0.7,
        },
      },
    ],
  },
};

type FeatureProperties = Record<string, unknown>;

interface InfoFieldConfig {
  label: string;
  getValue: (props: FeatureProperties) => unknown;
}

import { extractWikidataId, fetchWikidataData, getCachedWikidataData } from '@/lib/api/wikidata';
import { getBboxFromGeometry, calculateZoomFromBbox } from '@/lib/geo-utils';

const CATEGORY_LABELS: Record<Category, string> = {
  lines: 'Transmission Line',
  minor_lines: 'Minor Line',
  cables: 'Cable',
  plants: 'Plant',
  generators: 'Generator',
  substations: 'Substation',
  towers: 'Tower',
  poles: 'Pole',
  switches: 'Switch',
  transformers: 'Transformer',
  compensators: 'Compensator',
  converters: 'Converter Station',
};

const toTitleCase = (value: string): string =>
  value
    .split(/[_\s-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const NAME_PROPERTY_KEYS = new Set(['name', 'plant:name', 'generator:name']);
const EXCLUDED_FALLBACK_KEYS = new Set(['tags', 'json', 'tippecanoe', 'output']);
const EXCLUDED_FALLBACK_PREFIXES = ['tippecanoe', 'tags'];

const normaliseParts = (value: unknown): string[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normaliseParts(entry))
      .flat()
      .filter((entry) => entry.length > 0);
  }

  let stringValue = String(value).trim();

  // Handle stringified arrays like "[132,66]"
  if (stringValue.startsWith('[') && stringValue.endsWith(']')) {
    stringValue = stringValue.slice(1, -1);
  }

  if (!stringValue) {
    return [];
  }

  return stringValue
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^"|"$/g, '')) // Remove quotes if present
    .filter((entry) => entry.length > 0);
};

const formatVoltageList = (value: unknown, fromUnit: 'kv' | 'v'): string | undefined => {
  const parts = normaliseParts(value);
  if (!parts.length) {
    return undefined;
  }

  const validVoltages: number[] = [];

  parts.forEach((part) => {
    const numeric = Number(part);
    if (Number.isFinite(numeric)) {
      // Filter out unrealistic voltages (e.g. > 1200kV)
      // If unit is 'v', 1200kV = 1,200,000v
      const inKv = fromUnit === 'v' ? numeric / 1000 : numeric;
      if (inKv <= 1200) {
        validVoltages.push(inKv);
      }
    }
  });

  if (validVoltages.length === 0) {
    // If no valid numbers, return original parts (fallback)
    // But user asked to limit parsing, so maybe we should return undefined?
    // Let's return the original parts if we couldn't parse any numbers,
    // but if we parsed some and filtered others, show the valid ones.
    // If we have parts but they aren't numbers, show them as is?
    // The user said "Could not convert... to number", implying they want numbers.
    // Let's stick to valid numbers if possible.
    if (parts.length > 0 && validVoltages.length === 0) {
      // Check if parts look like non-numbers (e.g. "Unknown")
      // If they are just bad numbers like "1100011", we filtered them.
      // Let's return undefined if we filtered everything out.
      return undefined;
    }
  }

  // Sort descending (largest first)
  validVoltages.sort((a, b) => b - a);

  return validVoltages
    .map((kv) => {
      const rounded = kv >= 10 ? Math.round(kv) : Number(kv.toFixed(1));
      return `${rounded} kV`;
    })
    .join(', ');
};

const formatCapacityMw = (value: unknown): string | undefined => {
  const parts = normaliseParts(value);
  if (!parts.length) {
    return undefined;
  }

  const formatted = parts.map((part) => {
    const numeric = Number(part);
    if (!Number.isFinite(numeric)) {
      return part;
    }

    const rounded = numeric >= 10 ? Math.round(numeric) : Number(numeric.toFixed(1));
    return `${rounded} MW`;
  });

  return formatted.join(', ');
};

const toDisplayString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => toDisplayString(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return parts.length ? parts.join(', ') : undefined;
  }

  const text = String(value).trim();
  return text.length ? text : undefined;
};

const priorityString = (values: Array<unknown>): string | undefined => {
  for (const value of values) {
    const display = toDisplayString(value);
    if (display) {
      return display;
    }
  }
  return undefined;
};

const formatPlantSource = (value: unknown): string | undefined => {
  const display = toDisplayString(value);
  if (!display) {
    return undefined;
  }

  return display
    .split(/[;,]/)
    .map((part) => toTitleCase(part.trim()))
    .filter((part) => part.length > 0)
    .join(', ');
};

const CATEGORY_INFO_FIELDS: Record<Category, InfoFieldConfig[]> = {
  lines: [
    { label: 'Name', getValue: (props) => props['name'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        formatVoltageList(props['voltage_kv'], 'kv') ?? formatVoltageList(props['voltage'], 'v'),
    },
    { label: 'Operator', getValue: (props) => props['operator'] },
    { label: 'Circuits', getValue: (props) => props['circuits'] ?? props['circuit'] },
  ],
  minor_lines: [
    { label: 'Name', getValue: (props) => props['name'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        formatVoltageList(props['voltage_kv'], 'kv') ?? formatVoltageList(props['voltage'], 'v'),
    },
    { label: 'Operator', getValue: (props) => props['operator'] },
    { label: 'Circuits', getValue: (props) => props['circuits'] ?? props['circuit'] },
  ],
  cables: [
    { label: 'Name', getValue: (props) => props['name'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        formatVoltageList(props['voltage_kv'], 'kv') ?? formatVoltageList(props['voltage'], 'v'),
    },
    { label: 'Operator', getValue: (props) => props['operator'] },
    { label: 'Circuits', getValue: (props) => props['circuits'] ?? props['circuit'] },
  ],
  plants: [
    { label: 'Name', getValue: (props) => props['name'] ?? props['plant:name'] },
    {
      label: 'Capacity',
      getValue: (props) =>
        formatCapacityMw(props['plant:output:electricity']) ??
        formatCapacityMw(props['output:electricity']),
    },
    { label: 'Source', getValue: (props) => formatPlantSource(props['plant:source']) },
    { label: 'Turbines', getValue: (props) => props['turbines'] },
    { label: 'Start Date', getValue: (props) => props['start_date'] },
    { label: 'Operator', getValue: (props) => props['operator'] ?? props['plant:operator'] },
  ],
  generators: [
    { label: 'Name', getValue: (props) => props['name'] ?? props['generator:name'] },
    {
      label: 'Output',
      getValue: (props) =>
        formatCapacityMw(props['generator:output:electricity']) ??
        formatCapacityMw(props['output:electricity']),
    },
    {
      label: 'Source',
      getValue: (props) =>
        formatPlantSource(props['generator:source']) ?? formatPlantSource(props['generator:type']),
    },
    { label: 'Turbines', getValue: (props) => props['turbines'] },
    { label: 'Start Date', getValue: (props) => props['start_date'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        formatVoltageList(props['voltage_kv'], 'kv') ?? formatVoltageList(props['voltage'], 'v'),
    },
  ],
  substations: [
    { label: 'Name', getValue: (props) => props['name'] },
    { label: 'Type', getValue: (props) => props['substation'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        formatVoltageList(props['voltage_kv'], 'kv') ??
        priorityString([
          formatVoltageList(props['voltage:primary'], 'kv'),
          formatVoltageList(props['voltage:secondary'], 'kv'),
          formatVoltageList(props['voltage'], 'v'),
        ]),
    },
    { label: 'Operator', getValue: (props) => props['operator'] },
  ],
  towers: [
    { label: 'Reference', getValue: (props) => props['ref'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
    { label: 'Material', getValue: (props) => props['material'] },
  ],
  poles: [
    { label: 'Reference', getValue: (props) => props['ref'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
    { label: 'Material', getValue: (props) => props['material'] },
  ],
  switches: [
    { label: 'Name', getValue: (props) => props['name'] },
    { label: 'Type', getValue: (props) => props['switch'] ?? props['switch:type'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
  ],
  transformers: [
    { label: 'Name', getValue: (props) => props['name'] },
    {
      label: 'Voltage',
      getValue: (props) =>
        priorityString([
          formatVoltageList(props['voltage:primary'], 'kv'),
          formatVoltageList(props['voltage:secondary'], 'kv'),
          formatVoltageList(props['voltage'], 'v'),
        ]),
    },
    { label: 'Operator', getValue: (props) => props['operator'] },
  ],
  compensators: [
    { label: 'Name', getValue: (props) => props['name'] },
    { label: 'Type', getValue: (props) => props['compensator'] ?? props['device'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
  ],
  converters: [
    { label: 'Name', getValue: (props) => props['name'] },
    { label: 'Technology', getValue: (props) => props['converter'] ?? props['technology'] },
    { label: 'Operator', getValue: (props) => props['operator'] },
  ],
};

const buildPopupInfo = (
  category: Category,
  properties: FeatureProperties,
  _geometryType?: string,
  _variantSuffix?: string | null,
  coordinates?: [number, number],
  zoom?: number,
): PopupInfo => {
  const fields = CATEGORY_INFO_FIELDS[category] ?? [];
  const rows: Array<{ label: string; value: string }> = [];
  const seenLabels = new Set<string>();

  fields.forEach((field) => {
    const rawValue = field.getValue(properties);
    const display = toDisplayString(rawValue);
    if (!display) {
      return;
    }

    const label = field.label;
    if (seenLabels.has(label) || label === 'Name') {
      return;
    }

    seenLabels.add(label);
    rows.push({ label, value: display });
  });

  if (!rows.length) {
    const fallbackPairs = Object.entries(properties)
      .filter(([key, value]) => {
        if (typeof value === 'object' || typeof value === 'undefined') {
          return false;
        }
        if (NAME_PROPERTY_KEYS.has(key)) {
          return false;
        }
        if (EXCLUDED_FALLBACK_KEYS.has(key)) {
          return false;
        }
        if (EXCLUDED_FALLBACK_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          return false;
        }
        return true;
      })
      .slice(0, 6);

    fallbackPairs.forEach(([key, value]) => {
      const display = toDisplayString(value);
      if (!display) {
        return;
      }
      rows.push({ label: toTitleCase(key), value: display });
    });
  }

  const repdId = toDisplayString(properties['repd:id']);
  if (repdId && !seenLabels.has('REPD ID')) {
    seenLabels.add('REPD ID');
    rows.push({ label: 'REPD ID', value: repdId });
  }

  const name = priorityString([
    properties['name'],
    properties['ref'],
    properties['plant:name'],
    properties['generator:name'],
  ]);

  return {
    title: name ?? CATEGORY_LABELS[category],
    subtitle: undefined,
    rows,
    properties,
    coordinates,
    zoom,
  };
};

const isCategoryKey = (value: string): value is Category =>
  Object.prototype.hasOwnProperty.call(CATEGORY_STYLES, value);

const getLayerCategory = (
  layer: LayerSpecification,
): { category: Category; variantSuffix?: string | null } | null => {
  const metadata = layer.metadata as { category?: unknown; variantSuffix?: unknown } | undefined;
  if (metadata && typeof metadata.category === 'string' && isCategoryKey(metadata.category)) {
    const variantSuffix =
      typeof metadata.variantSuffix === 'string' || metadata.variantSuffix === null
        ? metadata.variantSuffix
        : undefined;
    return { category: metadata.category, variantSuffix };
  }

  if (typeof layer.id === 'string' && layer.id.startsWith('pwr-')) {
    const remainder = layer.id.slice(4);
    const dashIndex = remainder.indexOf('-');
    const categoryKey = dashIndex >= 0 ? remainder.slice(0, dashIndex) : remainder;
    if (isCategoryKey(categoryKey)) {
      const suffix = dashIndex >= 0 ? remainder.slice(dashIndex) : undefined;
      return { category: categoryKey, variantSuffix: suffix };
    }
  }

  return null;
};

export const getMap = () => mapInstance;

export const ensureSourceExists = (
  map: maplibregl.Map,
  id: string,
  source: SourceSpecification,
) => {
  if (!map.getSource(id)) {
    map.addSource(id, source);
  }
};



const LABEL_NAME_FILTER: FilterSpecification = ['all', ['has', 'name'], ['!=', ['get', 'name'], '']];

const createArrowLabelImage = (height: number = 32) => {
  const canvas = document.createElement('canvas');
  // Fixed dimensions for the source image
  // 32px (Dot Area w/ 16px radius) + 16px (Body) + 16px (Right Cap) = 64
  const width = 64;

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw Pill shape (Stadium) - Manual Path for compatibility
  const radius = 16;
  ctx.fillStyle = '#ffffffff'; // Slate 200
  ctx.strokeStyle = '#e0e0e0ff'; // Slate 400
  ctx.lineWidth = 1;

  ctx.beginPath();
  // Top line
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  // Right Cap
  ctx.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
  // Bottom line
  ctx.lineTo(radius, height);
  // Left Cap
  ctx.arc(radius, radius, radius, Math.PI / 2, -Math.PI / 2);

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  return ctx.getImageData(0, 0, width, height);
};

const createDotImage = (color: string, iconType: 'bolt' | 'flame' | 'sun' | 'wind' | 'water' | 'nuclear' | 'leaf' | 'battery' = 'bolt', radius: number = 10) => {
  const size = radius * 2 + 4; // +4 for stroke/padding
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = size / 2;

  // Draw Circle
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // White Border
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // ---------------------------------------------------------
  // Draw Icon (White)
  // ---------------------------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const scale = radius / 10; // Scale relative to 10px baseline
  ctx.save();
  ctx.translate(center, center);
  ctx.scale(scale, scale);

  ctx.beginPath();

  if (iconType === 'bolt') {
    // Bolt Path (Baseline)
    ctx.moveTo(-2, -5);
    ctx.lineTo(3, -5);
    ctx.lineTo(0, 1);
    ctx.lineTo(4, 1);
    ctx.lineTo(-1, 6);
    ctx.lineTo(1, 0);
    ctx.lineTo(-3, 0);
    ctx.closePath();
    ctx.fill();
  } else if (iconType === 'flame') {
    // Flame Path
    // Simple flame shape
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-3, 6, -5, 3, -5, 0);
    ctx.bezierCurveTo(-5, -4, 0, -8, 0, -8);
    ctx.bezierCurveTo(0, -8, 5, -4, 5, 0);
    ctx.bezierCurveTo(5, 3, 3, 6, 0, 6);
    ctx.fill();
  } else if (iconType === 'sun') {
    // Sun
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Rays
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.moveTo(5, 0);
      ctx.lineTo(7, 0);
    }
    ctx.stroke();
  } else if (iconType === 'wind') {
    // Turbine (Three blades)
    // Draw center hub
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Blades
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(3, -2, 0, -7);
      ctx.quadraticCurveTo(-3, -2, 0, 0);
      ctx.fill();
      ctx.rotate((Math.PI * 2) / 3);
    }
  } else if (iconType === 'water') {
    // Water Droplet
    ctx.moveTo(0, -6);
    ctx.bezierCurveTo(4, -1, 5, 2, 5, 4);
    ctx.arc(0, 4, 5, 0, Math.PI, false);
    ctx.bezierCurveTo(-5, 2, -4, -1, 0, -6);
    ctx.fill();
  } else if (iconType === 'nuclear') {
    // Atom (3 orbits + nucleus)
    ctx.lineWidth = 1;
    // Nucleus
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    // Orbits
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.5, Math.PI / 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.5, Math.PI / 3 * 2, 0, Math.PI * 2); // Should be 2PI/3 but adjustment
    ctx.stroke();
  } else if (iconType === 'leaf') {
    // Leaf
    ctx.moveTo(0, 6);
    ctx.quadraticCurveTo(4, 2, 4, -4);
    ctx.quadraticCurveTo(0, -8, 0, -8);
    ctx.quadraticCurveTo(-4, -4, -4, 2);
    ctx.quadraticCurveTo(-2, 5, 0, 6);
    ctx.fill();
    // Stem
    // ctx.beginPath();
    // ctx.moveTo(0, 6);
    // ctx.lineTo(0, 8);
    // ctx.stroke();
  } else if (iconType === 'battery') {
    // Battery
    // Body
    ctx.rect(-3.5, -5, 7, 9);
    ctx.fill();
    // Positive terminal
    ctx.beginPath();
    ctx.rect(-1.5, -7, 3, 2);
    ctx.fill();
    // Bolt inside (cutout - draw black/transparent?)
    // Actually just draw solid battery for visibility
  }

  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
};

const addPowerLabelLayers = (
  map: maplibregl.Map,
  groupVisibility: Record<LayerGroupId, boolean>,
  layerGroupAssignments: Map<string, LayerGroupId>,
): string[] => {
  const addedIds: string[] = [];

  const configs = [
    { type: 'substations', sourceLayer: 'label_substations', groupId: 'substations', color: '#64748b' }, // Slate
    { type: 'converters', sourceLayer: 'label_converters', groupId: 'substations', color: '#8b5cf6' }, // Violet
    { type: 'plants', sourceLayer: 'label_plants', groupId: 'powerPlants', color: '#10b981' }, // Emerald - Added LAST to be ON TOP
  ];



  configs.forEach((config) => {
    const dotId = `${POWER_LABEL_LAYER_PREFIX}${config.type}-dot`;
    const textId = `${POWER_LABEL_LAYER_PREFIX}${config.type}-text`;
    // We check the specific group ID correctly here
    const isVisible = groupVisibility[config.groupId as LayerGroupId];

    // Data-driven Icon selection for Plants
    let iconImageProd: any = `dot-${config.type}`; // Default for substations/converters

    if (config.type === 'plants') {
      // Construct a match expression to pick the right icon based on fuel type
      // Note: We register these images in the load event below
      iconImageProd = [
        'match',
        ['get', 'plant:source'],
        // Solar
        'solar', 'dot-plant-solar',
        // Gas
        'gas', 'dot-plant-gas',
        // Wind
        'wind', 'dot-plant-wind',
        // Hydro
        'hydro', 'dot-plant-hydro',
        // Nuclear
        'nuclear', 'dot-plant-nuclear',
        // Biomass
        'biomass', 'dot-plant-biomass',
        // Battery
        'battery', 'dot-plant-battery',
        // Coal
        'coal', 'dot-plant-coal',
        // Oil
        'oil', 'dot-plant-coal', // Same dark grey bolt
        'diesel', 'dot-plant-coal',
        // Waste
        'waste', 'dot-plant-waste',
        // Default
        'dot-plants' // Fallback (Emerald Bolt)
      ];
    }

    // Determine text-field expression based on type
    let textField: any = ['get', 'name'];
    let capacityColorExpression: any = '#15803d'; // Default Emerald

    // If plant, capacity color matches the dot color
    if (config.type === 'plants') {
      capacityColorExpression = [
        'match',
        ['get', 'plant:source'],
        'solar', '#eab308', // Yellow
        'gas', '#f97316',   // Orange
        'wind', '#22c55e',  // Green 
        'hydro', '#0ea5e9', // Light Blue
        'nuclear', '#3b82f6', // Blue
        'biomass', '#15803d', // Dark Green
        'battery', '#ef4444', // Red
        'coal', '#374151',    // Dark Grey
        'oil', '#374151',
        'diesel', '#374151',
        'waste', '#92400e',   // Brown
        '#15803d' // Default Emerald
      ];

      textField = [
        'format',
        ['get', 'name'], { 'text-color': '#0f172a' },
        '   ', {},
        ['coalesce', ['get', 'plant:output:electricity'], ['get', 'output:electricity'], ''], { 'text-color': capacityColorExpression, 'text-font': ['literal', ['Open Sans Bold']] },
      ];
    } else if (config.type === 'substations') {
      textField = [
        'format',
        ['get', 'name'], { 'text-color': '#0f172a' },
        '   ', {},
        ['coalesce', ['get', 'voltage_kv'], ['get', 'voltage'], ''], { 'text-color': '#64748b', 'text-font': ['literal', ['Open Sans Bold']] },
      ];
    }

    // 1. Text Layer (Add FIRST so it is behind the dot)
    if (!map.getLayer(textId)) {
      map.addLayer({
        id: textId,
        type: 'symbol',
        source: POWER_LABEL_SOURCE_ID,
        'source-layer': config.sourceLayer,
        minzoom: 6,
        layout: {
          visibility: isVisible ? 'visible' : 'none',
          'text-field': textField,
          'text-font': ['Open Sans Regular'],
          'text-size': 14,
          'text-anchor': 'left',
          'text-allow-overlap': false,
          'text-ignore-placement': false,

          // Icon configuration (The Arrow Background)
          'icon-image': 'label-arrow-bg',
          'icon-text-fit': 'both',
          'icon-anchor': 'left',
          'icon-allow-overlap': false,
          'text-max-width': 24, // Allow wider text before wrapping
        },
        paint: {
          'text-color': '#0f172a', // Slate 900
          'icon-opacity': 0.95,
          'text-translate': [16, 0], // Align Left Cap Center (Image x=16) to Dot
        },
        metadata: {
          category: config.type,
          variantSuffix: 'label'
        },
        filter: config.type === 'substations'
          ? ['all', LABEL_NAME_FILTER, ['>', VOLTAGE_EXPR, 33]]
          : LABEL_NAME_FILTER
      });
      addedIds.push(textId);
    }

    if (map.getLayer(textId)) {
      layerGroupAssignments.set(textId, config.groupId as LayerGroupId);
      const desired = isVisible ? 'visible' : 'none';
      if (map.getLayoutProperty(textId, 'visibility') !== desired) {
        map.setLayoutProperty(textId, 'visibility', desired);
      }
    }

    // 2. Dot Layer (Symbol to ensure z-index on top of label)
    if (!map.getLayer(dotId)) {
      map.addLayer({
        id: dotId,
        type: 'symbol',
        source: POWER_LABEL_SOURCE_ID,
        'source-layer': config.sourceLayer,
        minzoom: 6,
        layout: {
          visibility: isVisible ? 'visible' : 'none',
          'icon-image': iconImageProd,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-anchor': 'center'
        },
        paint: {
          'icon-opacity': 1,
        },
        metadata: {
          category: config.type,
          variantSuffix: 'dot'
        },
        filter: LABEL_NAME_FILTER
      });
      addedIds.push(dotId);
    }

    // Always update assignments and visibility if the layer exists (idempotent)
    if (map.getLayer(dotId)) {
      layerGroupAssignments.set(dotId, config.groupId as LayerGroupId);
      const desired = isVisible ? 'visible' : 'none';
      if (map.getLayoutProperty(dotId, 'visibility') !== desired) {
        map.setLayoutProperty(dotId, 'visibility', desired);
      }
    }
  });

  return addedIds;
};

const addPowerLayers = async (
  map: maplibregl.Map,
  archive: PMTiles,
  groupVisibility: Record<LayerGroupId, boolean>,
  layerGroupAssignments: Map<string, LayerGroupId>,
): Promise<string[]> => {
  const metadata = await archive.getMetadata().catch((error) => {
    console.warn('[MapView] unable to fetch PMTiles metadata', error);
    return null;
  });

  const availableLayers = extractVectorLayerIds(metadata);

  const layerResults: Array<{ category: Category; status: 'added' | 'skipped' }> = [];
  const addedLayerIds: string[] = [];

  Object.entries(CATEGORY_STYLES)
    .sort(([, a], [, b]) => a.zIndex - b.zIndex)
    .forEach(([category, style]) => {
      const typedCategory = category as Category;
      if (availableLayers.size && !availableLayers.has(style.sourceLayer)) {
        layerResults.push({ category: typedCategory, status: 'skipped' });
        return;
      }

      let addedVariant = false;

      style.variants.forEach((variant) => {
        const layerId = 'pwr-' + typedCategory + (variant.idSuffix ?? '');
        if (map.getLayer(layerId)) {
          addedVariant = true;
          return;
        }

        const baseLayout = variant.layout ? { ...variant.layout } : undefined;
        const variantSuffix = variant.idSuffix ?? null;
        const groupId = resolveLayerGroup(typedCategory, variantSuffix);

        const layer: any = {
          id: layerId,
          source: POWER_SOURCE_ID,
          'source-layer': style.sourceLayer,
          type: variant.geometry,
          paint: variant.paint,
          minzoom: variant.minzoom ?? style.baseMinzoom ?? 0,
          metadata: {
            category: typedCategory,
            variantSuffix,
            groupId: groupId ?? null,
          },
        };

        if (typeof variant.maxzoom === 'number') {
          layer.maxzoom = variant.maxzoom;
        }

        if (variant.filter) {
          layer.filter = variant.filter;
        }

        let layoutToApply = baseLayout;
        if (groupId) {
          layerGroupAssignments.set(layerId, groupId);
          if (!groupVisibility[groupId]) {
            layoutToApply = { ...(layoutToApply ?? {}), visibility: 'none' as const };
          }
        }

        if (layoutToApply) {
          layer.layout = layoutToApply;
        }

        map.addLayer(layer as LayerSpecification);
        addedVariant = true;
        addedLayerIds.push(layerId);
      });

      layerResults.push({ category: typedCategory, status: addedVariant ? 'added' : 'skipped' });
    });

  const added = layerResults
    .filter((entry) => entry.status === 'added')
    .map((entry) => entry.category);
  const skipped = layerResults
    .filter((entry) => entry.status === 'skipped')
    .map((entry) => entry.category);

  console.info('[MapView] power layer summary', {
    added,
    skipped,
  });

  return addedLayerIds;
};

interface MapViewProps {
  className?: string;
}

const MapView = ({ className }: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const initialViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const clickableLayerIdsRef = useRef<string[]>([]);
  const layerGroupAssignmentsRef = useRef<Map<string, LayerGroupId>>(new Map());
  const interactionCleanupRef = useRef<Array<() => void>>([]);
  const pendingImageRequestRef = useRef<{
    controller: AbortController;
    featureKey: string;
    wikidataId: string;
  } | null>(null);
  const [detailViewInfo, setDetailViewInfo] = useState<PopupInfo | null>(null);
  const activePopupInfoRef = useRef<PopupInfo | null>(null);
  const activeFeatureKeyRef = useRef<string | null>(null);
  const popupObserverRef = useRef<ResizeObserver | null>(null);
  const applyGroupVisibilityToMap = useCallback(
    (mapInstance: maplibregl.Map | null, visibility: Record<LayerGroupId, boolean>) => {
      if (!mapInstance) {
        return;
      }

      layerGroupAssignmentsRef.current.forEach((groupId, layerId) => {
        const targetVisibility = visibility[groupId] ? 'visible' : 'none';
        if (!mapInstance.getLayer(layerId)) {
          return;
        }

        const currentVisibility = mapInstance.getLayoutProperty(layerId, 'visibility');
        if (currentVisibility !== targetVisibility) {
          mapInstance.setLayoutProperty(layerId, 'visibility', targetVisibility);
        }
      });
    },
    [],
  );

  const setView = useAppStore((state) => state.setView);
  const setSelected = useAppStore((state) => state.setSelected);

  if (!initialViewRef.current) {
    const { center, zoom } = useAppStore.getState();
    initialViewRef.current = {
      center: [...center] as [number, number],
      zoom,
    };
  }

  useEffect(() => {
    if (!containerRef.current || !initialViewRef.current) {
      return undefined;
    }

    const baseUrl = import.meta.env.VITE_DATA_BASE_URL || window.location.origin;
    const pmtilesUrl = `${baseUrl}/power.pmtiles`;
    const archive = registerPmtilesArchive(pmtilesUrl);
    const labelPmtilesUrl = `${baseUrl}/powerlabels.pmtiles`;
    registerPmtilesArchive(labelPmtilesUrl);

    const map = new maplibregl.Map({
      container: containerRef.current,
      // center: initialViewRef.current.center,
      // zoom: initialViewRef.current.zoom,
      center: [-1.2, 53],
      zoom: 7,
      minZoom: 2,
      maxPitch: 0,
      style: {
        version: 8,
        name: 'Energy Accelerator Light',
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#f7f5ef' },
          },
        ],
      },
    });

    mapRef.current = map;
    mapInstance = map;

    resizeObserverRef.current = new ResizeObserver(() => map.resize());
    resizeObserverRef.current.observe(containerRef.current);

    const cleanupInteractionHandlers = () => {
      interactionCleanupRef.current.forEach((fn) => fn());
      interactionCleanupRef.current = [];
      clickableLayerIdsRef.current = [];
      const canvas = map.getCanvas();
      if (canvas) {
        canvas.style.cursor = '';
      }
    };

    const cancelPendingImageRequest = () => {
      if (pendingImageRequestRef.current) {
        pendingImageRequestRef.current.controller.abort();
        pendingImageRequestRef.current = null;
      }
    };

    const handleMapClick = (event: MapMouseEvent) => {
      if (!clickableLayerIdsRef.current.length) {
        if (popupRef.current) {
          popupRef.current.remove();
          if (popupObserverRef.current) {
            popupObserverRef.current.disconnect();
            popupObserverRef.current = null;
          }
          popupRef.current = null;
        }
        cancelPendingImageRequest();
        activePopupInfoRef.current = null;
        activeFeatureKeyRef.current = null;
        setSelected(null);
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: clickableLayerIdsRef.current,
      }) as MapGeoJSONFeature[];

      if (!features.length) {
        if (popupRef.current) {
          popupRef.current.remove();
          if (popupObserverRef.current) {
            popupObserverRef.current.disconnect();
            popupObserverRef.current = null;
          }
          popupRef.current = null;
        }
        cancelPendingImageRequest();
        activePopupInfoRef.current = null;
        activeFeatureKeyRef.current = null;
        setSelected(null);
        return;
      }

      const feature = features[0];
      const layerInfo = getLayerCategory(feature.layer);
      if (!layerInfo) {
        return;
      }

      const properties = (feature.properties ?? {}) as FeatureProperties;
      let zoom: number | undefined;
      if (feature.geometry) {
        const bbox = getBboxFromGeometry(feature.geometry);
        if (bbox) {
          zoom = calculateZoomFromBbox(bbox);
        }
      }

      let featureCoordinates: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      if (feature.geometry.type === 'Point') {
        const coords = (feature.geometry as any).coordinates;
        featureCoordinates = [coords[0], coords[1]];
      }

      const popupInfo = buildPopupInfo(
        layerInfo.category,
        properties,
        feature.geometry?.type,
        layerInfo.variantSuffix,
        featureCoordinates,
        zoom,
      );

      activePopupInfoRef.current = popupInfo;

      activePopupInfoRef.current = popupInfo;

      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'ea-popup-root',
          maxWidth: 'none',
          // @ts-ignore - autoPanPadding is supported by maplibre but missing in some type definitions
          autoPanPadding: { top: 100, bottom: 20, left: 20, right: 20 },
        });
      }

      const popupNode = document.createElement('div');
      const root = createRoot(popupNode);
      root.render(<FeaturePopup info={popupInfo} onExpand={() => setDetailViewInfo(popupInfo)} />);

      popupRef.current.setLngLat(featureCoordinates).setDOMContent(popupNode).addTo(map);

      // Clean up previous observer
      if (popupObserverRef.current) {
        popupObserverRef.current.disconnect();
        popupObserverRef.current = null;
      }

      // Add ResizeObserver to trigger pan when react renders content
      const observer = new ResizeObserver(() => {
        if (popupRef.current && popupRef.current.isOpen()) {
          // Force update of popup position by re-setting lngLat, which triggers autoPan check
          popupRef.current.setLngLat(popupRef.current.getLngLat());
        }
      });
      observer.observe(popupNode);
      popupObserverRef.current = observer;

      const featureKey = makeFeatureKey(properties, featureCoordinates);
      activeFeatureKeyRef.current = featureKey;

      setSelected(featureKey);

      cancelPendingImageRequest();

      const wikidataId = extractWikidataId(properties);
      if (!wikidataId) {
        return;
      }

      const cached = getCachedWikidataData(wikidataId);

      if (cached === undefined) {
        const controller = new AbortController();
        pendingImageRequestRef.current = { controller, featureKey, wikidataId };

        fetchWikidataData(wikidataId, controller.signal)
          .then((data) => {
            if (!data || (!data.imageUrl && (!data.bmuIds || data.bmuIds.length === 0))) {
              return;
            }

            if (activeFeatureKeyRef.current !== featureKey) {
              return;
            }

            const infoWithImage: PopupInfo = {
              ...popupInfo,
              imageUrl: data.imageUrl ?? undefined,
              bmuIds: data.bmuIds ?? undefined,
              bmuId: data.bmuIds?.[0] ?? undefined,
            };
            activePopupInfoRef.current = infoWithImage;

            if (popupRef.current) {
              const popupNode = document.createElement('div');
              const root = createRoot(popupNode);
              root.render(
                <FeaturePopup
                  info={infoWithImage}
                  onExpand={() => setDetailViewInfo(infoWithImage)}
                />,
              );
              popupRef.current.setDOMContent(popupNode);
            }
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') {
              return;
            }

            console.warn('[MapView] wikidata fetch failed', wikidataId, error);
          })
          .finally(() => {
            if (pendingImageRequestRef.current?.controller === controller) {
              pendingImageRequestRef.current = null;
            }
          });

        return;
      }

      if (!cached || (!cached.imageUrl && (!cached.bmuIds || cached.bmuIds.length === 0))) {
        return;
      }

      const infoWithImage: PopupInfo = {
        ...popupInfo,
        imageUrl: cached.imageUrl ?? undefined,
        bmuIds: cached.bmuIds ?? undefined,
        bmuId: cached.bmuIds?.[0] ?? undefined,
      };
      activePopupInfoRef.current = infoWithImage;

      if (popupRef.current && activeFeatureKeyRef.current === featureKey) {
        const popupNode = document.createElement('div');
        const root = createRoot(popupNode);
        root.render(
          <FeaturePopup info={infoWithImage} onExpand={() => setDetailViewInfo(infoWithImage)} />,
        );
        popupRef.current.setDOMContent(popupNode);
      }
    };
    const handleMoveEnd = () => {
      const currentCenter = map.getCenter();
      setView([currentCenter.lng, currentCenter.lat], map.getZoom());
    };

    map.on('moveend', handleMoveEnd);

    map.on('load', async () => {
      ensureBasemap(map);

      // Add custom arrow label background
      const arrowImg = createArrowLabelImage(32);
      if (arrowImg) {
        map.addImage('label-arrow-bg', arrowImg, {
          // Content box: [x1, y1, x2, y2]
          // x2 controls right padding: ImageWidth(64) - x2 = Padding.
          // Currently 44 means 20px padding. increase x2 to decrease padding.
          content: [16, 6, 46, 26],
          stretchX: [[16, 48]],      // Stretch body
          stretchY: [[8, 24]],       // Stretch vertically within padding
          pixelRatio: 1
        });
      }

      // Add custom dot images
      const baseDotConfigs = [
        { name: 'plants', color: '#10b981', icon: 'bolt' },
        { name: 'substations', color: '#64748b', icon: 'bolt' },
        { name: 'converters', color: '#8b5cf6', icon: 'bolt' },
      ];

      const plantTypeConfigs = [
        { name: 'plant-solar', color: '#eab308', icon: 'sun' }, // Yellow
        { name: 'plant-gas', color: '#f97316', icon: 'flame' }, // Orange
        { name: 'plant-wind', color: '#22c55e', icon: 'wind' }, // Green
        { name: 'plant-hydro', color: '#0ea5e9', icon: 'water' }, // Light Blue
        { name: 'plant-nuclear', color: '#3b82f6', icon: 'nuclear' }, // Blue
        { name: 'plant-biomass', color: '#15803d', icon: 'leaf' }, // Dark Green
        { name: 'plant-battery', color: '#ef4444', icon: 'battery' }, // Red
        { name: 'plant-coal', color: '#374151', icon: 'bolt' }, // Dark Grey
        { name: 'plant-waste', color: '#92400e', icon: 'flame' }, // Brown
      ] as const;

      // Register Base Types
      baseDotConfigs.forEach(cfg => {
        const dotImg = createDotImage(cfg.color, cfg.icon as any, 12);
        if (dotImg && !map.hasImage(`dot-${cfg.name}`)) {
          map.addImage(`dot-${cfg.name}`, dotImg, { pixelRatio: 1 });
        }
      });
      // Register Plant Sub-types
      plantTypeConfigs.forEach(cfg => {
        const dotImg = createDotImage(cfg.color, cfg.icon as any, 12);
        if (dotImg && !map.hasImage(`dot-${cfg.name}`)) {
          map.addImage(`dot-${cfg.name}`, dotImg, { pixelRatio: 1 });
        }
      });

      ensureSourceExists(map, POWER_SOURCE_ID, {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
      });

      ensureSourceExists(map, POWER_LABEL_SOURCE_ID, {
        type: 'vector',
        url: `pmtiles://${labelPmtilesUrl}`,
      });

      console.info('[MapView] power source ready', map.getSource(POWER_SOURCE_ID));

      const initialGroupVisibility = useAppStore.getState().groupVisibility;
      layerGroupAssignmentsRef.current.clear();
      const addedLayerIds = await addPowerLayers(
        map,
        archive,
        initialGroupVisibility,
        layerGroupAssignmentsRef.current,
      );

      const labelLayerIds = addPowerLabelLayers(
        map,
        initialGroupVisibility,
        layerGroupAssignmentsRef.current,
      );

      applyGroupVisibilityToMap(map, initialGroupVisibility);

      cleanupInteractionHandlers();
      const interactiveLayerIds = [...addedLayerIds, ...labelLayerIds];
      if (!interactiveLayerIds.length) {
        return;
      }

      clickableLayerIdsRef.current = interactiveLayerIds;

      map.on('click', handleMapClick);
      interactionCleanupRef.current.push(() => map.off('click', handleMapClick));

      interactiveLayerIds.forEach((layerId) => {
        const handleMouseEnter = () => {
          const canvas = map.getCanvas();
          if (canvas) {
            canvas.style.cursor = 'pointer';
          }
        };

        const handleMouseLeave = () => {
          const canvas = map.getCanvas();
          if (canvas) {
            canvas.style.cursor = '';
          }
        };

        map.on('mouseenter', layerId, handleMouseEnter);
        map.on('mouseleave', layerId, handleMouseLeave);

        interactionCleanupRef.current.push(() => {
          map.off('mouseenter', layerId, handleMouseEnter);
          map.off('mouseleave', layerId, handleMouseLeave);
        });
      });
    });

    map.on('error', (event) => {
      if (event?.error) {
        console.error('[MapView] map error', event.error);
      }
    });

    return () => {
      map.off('moveend', handleMoveEnd);
      cleanupInteractionHandlers();
      map.remove();
      mapRef.current = null;
      mapInstance = null;

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (popupRef.current) {
        popupRef.current.remove();
        if (popupObserverRef.current) {
          popupObserverRef.current.disconnect();
          popupObserverRef.current = null;
        }
        popupRef.current = null;
      }

      cancelPendingImageRequest();
      activePopupInfoRef.current = null;
      activeFeatureKeyRef.current = null;
      layerGroupAssignmentsRef.current.clear();

      setSelected(null);
    };
  }, [setSelected, setView, applyGroupVisibilityToMap]);

  const groupVisibility = useAppStore((state) => state.groupVisibility);

  useEffect(() => {
    applyGroupVisibilityToMap(mapRef.current, groupVisibility);
  }, [applyGroupVisibilityToMap, groupVisibility]);

  // Listen for Global Search Selection
  const selectedSearchResult = useAppStore((state) => state.selectedSearchResult);

  useEffect(() => {
    if (!selectedSearchResult || !mapInstance) return;

    // Fly to location
    mapInstance.flyTo({
      center: selectedSearchResult.coordinates,
      zoom: 13,
      essential: true
    });

    // Construct Popup immediately
    const searchPopupInfo: PopupInfo = {
      title: selectedSearchResult.name,
      subtitle: selectedSearchResult.technology_type ? toTitleCase(selectedSearchResult.technology_type.replace(/_/g, ' ')) : undefined,
      rows: [
        { label: 'Name', value: selectedSearchResult.name },
        { label: 'Type', value: selectedSearchResult.asset_type },
        ...(selectedSearchResult.capacity ? [{ label: 'Capacity', value: `${selectedSearchResult.capacity} MW` }] : [])
      ],
      coordinates: selectedSearchResult.coordinates,
      bmuId: undefined,
      zoom: 13
    };

    activePopupInfoRef.current = searchPopupInfo;

    if (popupRef.current) {
      const popupNode = document.createElement('div');
      const root = createRoot(popupNode);
      root.render(
        <FeaturePopup info={searchPopupInfo} onExpand={() => setDetailViewInfo(searchPopupInfo)} />,
      );

      popupRef.current
        .setLngLat(selectedSearchResult.coordinates)
        .setDOMContent(popupNode)
        .addTo(mapInstance);
    }
  }, [selectedSearchResult]);

  return (
    <>
      <div className={cn('relative h-full w-full', className)}>
        <div ref={containerRef} className="h-full w-full" />

        {/* Layer Groups Control (Example placement) */}
        <div className="absolute top-4 right-4 z-10 hidden sm:block">
          {/* Existing layer controls if any, or just empty space for now */}
        </div>
      </div>

      <FeatureDetailModal info={detailViewInfo} onClose={() => setDetailViewInfo(null)} />
    </>
  );
};

export default MapView;
