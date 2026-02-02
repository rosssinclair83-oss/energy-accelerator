export interface SatelliteProvider {
  getSatelliteImageUrl(lat: number, lng: number, options?: SatelliteOptions): string;
}

export interface SatelliteOptions {
  width?: number;
  height?: number;
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

const MAPBOX_ACCESS_TOKEN =
  'pk.eyJ1Ijoicm9zc3NpbmNsYWlyODMiLCJhIjoiY21pbWJ2M3ZuMHlmOTNlczViM213amRtayJ9.AQVmUrovIDIxmvhlj12Hjw';

export const getMapboxSatelliteImageUrl = (
  lat: number,
  lng: number,
  options: SatelliteOptions = {},
): string => {
  const {
    width = 600,
    height = 400,
    zoom = 15, // Default zoom level suitable for most power plants
    bearing = 0,
    pitch = 0,
  } = options;

  // Validate dimensions (Mapbox limits)
  const validWidth = Math.min(Math.max(width, 1), 1280);
  const validHeight = Math.min(Math.max(height, 1), 1280);

  // Mapbox Static Images API format:
  // https://api.mapbox.com/styles/v1/{username}/{style_id}/static/{lon},{lat},{zoom},{bearing},{pitch}/{width}x{height}?access_token={token}
  // Using mapbox/satellite-v9 style
  const styleId = 'mapbox/satellite-v9';

  return `https://api.mapbox.com/styles/v1/${styleId}/static/${lng},${lat},${zoom},${bearing},${pitch}/${validWidth}x${validHeight}?access_token=${MAPBOX_ACCESS_TOKEN}`;
};
