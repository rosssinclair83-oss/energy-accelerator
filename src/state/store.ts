import { create } from 'zustand';

const MAP_INITIAL_CENTER: [number, number] = [-2.5, 54];
const MAP_INITIAL_ZOOM = 5;

export type LayerId =
  | 'cables'
  | 'compensators'
  | 'converters'
  | 'generators'
  | 'lines'
  | 'minor_lines'
  | 'plants'
  | 'poles'
  | 'substations'
  | 'switches'
  | 'towers'
  | 'transformers';

export type LayerGroupId =
  | 'powerPlants'
  | 'powerGenerators'
  | 'substations'
  | 'transformers'
  | 'transmission'
  | 'cables'
  | 'distribution'
  | 'switchgear';

interface MapSlice {
  center: [number, number];
  zoom: number;
  setView: (center: [number, number], zoom: number) => void;
}

type LayerVisibility = Record<LayerId, boolean>;

interface LayersSlice {
  visibility: LayerVisibility;
  setLayerVisibility: (id: LayerId, visible: boolean) => void;
  setAllLayers: (visible: boolean) => void;
}

interface InteractionSlice {
  hoverKey: string | null;
  selectedKey: string | null;
  setHover: (key: string | null) => void;
  setSelected: (key: string | null) => void;
}

interface UiSlice {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

interface LayerGroupSlice {
  groupVisibility: Record<LayerGroupId, boolean>;
  setLayerGroupVisibility: (id: LayerGroupId, visible: boolean) => void;
}

export interface SearchResult {
  id: string;
  name: string;
  asset_type: string;
  capacity?: number;
  coordinates: [number, number];
  technology_type?: string;
}

interface SearchSlice {
  selectedSearchResult: SearchResult | null;
  setSelectedSearchResult: (result: SearchResult | null) => void;
}

const GROUP_LAYER_RELATION: Partial<Record<LayerGroupId, LayerId[]>> = {
  powerPlants: ['plants'],
  powerGenerators: ['generators'],
  substations: ['substations', 'compensators', 'converters', 'transformers', 'switches'],
  transmission: ['lines', 'towers'],
  cables: ['cables'],
  distribution: ['minor_lines', 'poles'],
};

type StoreState = MapSlice & LayersSlice & InteractionSlice & UiSlice & LayerGroupSlice & SearchSlice;

const createInitialGroupVisibility = (): Record<LayerGroupId, boolean> => ({
  powerPlants: true,
  powerGenerators: true,
  substations: true,
  transformers: true,
  transmission: true,
  cables: true,
  distribution: true,
  switchgear: true,
});

const createInitialLayerVisibility = (): LayerVisibility => ({
  cables: true,
  compensators: true,
  converters: true,
  generators: true,
  lines: true,
  minor_lines: true,
  plants: true,
  poles: true,
  substations: true,
  switches: true,
  towers: true,
  transformers: true,
});

export const useAppStore = create<StoreState>((set) => ({
  center: MAP_INITIAL_CENTER,
  zoom: MAP_INITIAL_ZOOM,
  setView: (center, zoom) => set({ center, zoom }),
  visibility: createInitialLayerVisibility(),
  groupVisibility: createInitialGroupVisibility(),
  setLayerGroupVisibility: (id, visible) =>
    set((state) => {
      const nextGroupVisibility = { ...state.groupVisibility, [id]: visible };
      const relatedLayers = GROUP_LAYER_RELATION[id] ?? [];

      let nextLayerVisibility = state.visibility;
      if (relatedLayers.length) {
        nextLayerVisibility = { ...state.visibility };
        relatedLayers.forEach((layerId) => {
          nextLayerVisibility[layerId] = visible;
        });
      }

      return {
        groupVisibility: nextGroupVisibility,
        visibility: nextLayerVisibility,
      };
    }),
  setLayerVisibility: (id, visible) =>
    set((state) => ({ visibility: { ...state.visibility, [id]: visible } })),
  setAllLayers: (visible) =>
    set({
      visibility: Object.fromEntries(
        Object.keys(createInitialLayerVisibility()).map((key) => [key, visible]),
      ) as LayerVisibility,
    }),
  hoverKey: null,
  selectedKey: null,
  setHover: (key) => set({ hoverKey: key }),
  setSelected: (key) => set({ selectedKey: key }),
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  selectedSearchResult: null,
  setSelectedSearchResult: (result) => set({ selectedSearchResult: result }),
}));

export const makeFeatureKey = (
  tags: Record<string, unknown> | null | undefined,
  centroid: [number, number] | null | undefined,
): string => {
  const tagPart = tags
    ? Object.keys(tags)
      .sort()
      .map((key) => `${key}:${String(tags[key])}`)
      .join('|')
    : 'no-tags';

  const centroidPart = centroid
    ? centroid.map((value) => value.toFixed(6)).join(',')
    : 'no-centroid';

  return `${tagPart}#${centroidPart}`;
};
