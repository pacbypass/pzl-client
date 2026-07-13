/**
 * Base and overlay map layers recovered from the decompiled bundle — the same
 * Polish government WMS/WMTS services the original app uses.
 */
export type RasterLayer = {
  key: string;
  title: string;
  type: 'wms' | 'wmts-xyz';
  /** Tile URL template with {z}/{x}/{y} (or a WMS GetMap base for wms). */
  url: string;
  /** WMS layer name(s). */
  layers?: string;
  attribution: string;
  defaultOn?: boolean;
};

// WMTS StandardResolution exposes an EPSG:3857 / GoogleMapsCompatible matrix set,
// consumable as XYZ tiles.
const ORTO_WMTS =
  'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
  '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA' +
  '&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857' +
  '&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}';

export const BASE_LAYERS: RasterLayer[] = [
  {
    key: 'osm',
    title: 'OpenStreetMap',
    type: 'wmts-xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    defaultOn: true,
  },
  {
    key: 'orto',
    title: 'Ortofotomapa (GUGiK)',
    type: 'wmts-xyz',
    url: ORTO_WMTS,
    attribution: '© GUGiK Geoportal',
  },
];

export const OVERLAY_LAYERS: RasterLayer[] = [
  {
    key: 'bdl',
    title: 'Lasy Państwowe (BDL)',
    type: 'wms',
    url: 'https://mapserver.bdl.lasy.gov.pl/ArcGIS/services/WMS_BDL/mapserver/WMSServer',
    layers: '0',
    attribution: '© Lasy Państwowe / BDL',
  },
  {
    key: 'cadastre',
    title: 'Ewidencja gruntów (KIEG)',
    type: 'wms',
    url: 'https://integracja01.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow/wss/service/pub/guest/G2_GO_WMS/MapServer/WMSServer',
    layers: 'dzialki,numery_dzialek',
    attribution: '© GUGiK KIEG',
  },
  {
    key: 'bdot10k',
    title: 'BDOT10k (topografia)',
    type: 'wms',
    url: 'https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer',
    layers: 'Raster',
    attribution: '© GUGiK Geoportal',
  },
];

/** Build a WMS GetMap tile URL template usable as a raster source. */
export function wmsTileTemplate(layer: RasterLayer): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    LAYERS: layer.layers ?? '0',
    CRS: 'EPSG:3857',
    WIDTH: '256',
    HEIGHT: '256',
    STYLES: '',
  });
  // {bbox-epsg-3857} is substituted by MapLibre for WMS raster sources.
  return `${layer.url}?${params.toString()}&BBOX={bbox-epsg-3857}`;
}

/** Poland centroid — sensible initial camera. */
export const POLAND_CENTER = { longitude: 19.145, latitude: 52.0, zoom: 6 };
