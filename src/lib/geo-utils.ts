import type { Geometry } from 'geojson';

/**
 * Calculates the bounding box [minLng, minLat, maxLng, maxLat] for a given GeoJSON geometry.
 */
export const getBboxFromGeometry = (
  geometry: Geometry,
): [number, number, number, number] | null => {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates;
    return [lng, lat, lng, lat];
  }

  if (geometry.type === 'LineString') {
    return getCoordinatesBbox(geometry.coordinates);
  }

  if (geometry.type === 'Polygon') {
    return getCoordinatesBbox(geometry.coordinates.flat());
  }

  if (geometry.type === 'MultiPoint') {
    return getCoordinatesBbox(geometry.coordinates);
  }

  if (geometry.type === 'MultiLineString') {
    return getCoordinatesBbox(geometry.coordinates.flat());
  }

  if (geometry.type === 'MultiPolygon') {
    return getCoordinatesBbox(geometry.coordinates.flat(2));
  }

  return null;
};

const getCoordinatesBbox = (coords: number[][]): [number, number, number, number] => {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
};

/**
 * Calculates an appropriate zoom level to fit the given bounding box within a viewport.
 * @param bbox [minLng, minLat, maxLng, maxLat]
 * @param width Viewport width in pixels (default 600)
 * @param height Viewport height in pixels (default 400)
 * @param padding Padding in pixels (default 20)
 */
export const calculateZoomFromBbox = (
  bbox: [number, number, number, number],
  width: number = 600,
  height: number = 400,
  padding: number = 20,
): number => {
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // If it's a single point (or very small area), return default zoom
  if (maxLng === minLng && maxLat === minLat) {
    return 15;
  }

  const WORLD_DIM = { height: 256, width: 256 };
  const ZOOM_MAX = 19;

  function latRad(lat: number) {
    const sin = Math.sin((lat * Math.PI) / 180);
    const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
    return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
  }

  function zoom(mapPx: number, worldPx: number, fraction: number) {
    return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2);
  }

  const latFraction = (latRad(maxLat) - latRad(minLat)) / Math.PI;
  const lngDiff = maxLng - minLng;
  const lngFraction = (lngDiff < 0 ? lngDiff + 360 : lngDiff) / 360;

  const latZoom = zoom(height - padding * 2, WORLD_DIM.height, latFraction);
  const lngZoom = zoom(width - padding * 2, WORLD_DIM.width, lngFraction);

  return Math.min(latZoom, lngZoom, ZOOM_MAX);
};
