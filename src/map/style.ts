import {
  BASE_LAYERS,
  OVERLAY_LAYERS,
  wmsTileTemplate,
  type RasterLayer,
} from '@/map/layers';
import type { FeatureCollection } from '@/features/map/geo';

export type VectorOverlay = {
  key: string;
  kind: 'polygon' | 'point';
  data: FeatureCollection;
  color: string;
  /** property names to try for a text label (polygons only). */
  labelKeys?: string[];
};

/**
 * Builds a MapLibre GL style JSON from the active raster layers plus any vector
 * overlays (hunting districts / rewiry, devices, stands). The GeoJSON is baked
 * directly into the style's `sources`, so the exact same style renders on
 * maplibre-gl (web) and @maplibre/maplibre-react-native (native) — and, because
 * the data is inline, it draws with no network once cached.
 */
export function buildMapStyle(
  activeRasterKeys: Set<string>,
  vectorOverlays: VectorOverlay[] = [],
) {
  const rasters = [...BASE_LAYERS, ...OVERLAY_LAYERS].filter((l) =>
    activeRasterKeys.has(l.key),
  );

  const sources: Record<string, object> = {};
  const layers: object[] = [];

  for (const l of rasters) {
    sources[l.key] = {
      type: 'raster',
      tiles: [tileUrl(l)],
      tileSize: 256,
      attribution: l.attribution,
    };
    layers.push({ id: `raster-${l.key}`, type: 'raster', source: l.key });
  }

  for (const ov of vectorOverlays) {
    const src = `geo-${ov.key}`;
    sources[src] = { type: 'geojson', data: ov.data };
    if (ov.kind === 'polygon') {
      layers.push({
        id: `${src}-fill`,
        type: 'fill',
        source: src,
        paint: { 'fill-color': ov.color, 'fill-opacity': 0.12 },
      });
      layers.push({
        id: `${src}-line`,
        type: 'line',
        source: src,
        paint: { 'line-color': ov.color, 'line-width': 2 },
      });
      if (ov.labelKeys?.length) {
        layers.push({
          id: `${src}-label`,
          type: 'symbol',
          source: src,
          layout: {
            'text-field': [
              'coalesce',
              ...ov.labelKeys.map((k) => ['get', k]),
              '',
            ],
            'text-size': 12,
            'symbol-placement': 'point',
          },
          paint: {
            'text-color': ov.color,
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.4,
          },
        });
      }
    } else {
      layers.push({
        id: `${src}-circle`,
        type: 'circle',
        source: src,
        paint: {
          'circle-radius': 6,
          'circle-color': ov.color,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    }
  }

  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources,
    layers,
  };
}

function tileUrl(l: RasterLayer): string {
  return l.type === 'wms' ? wmsTileTemplate(l) : l.url;
}

export function defaultActiveKeys(): Set<string> {
  return new Set(
    [...BASE_LAYERS, ...OVERLAY_LAYERS]
      .filter((l) => l.defaultOn)
      .map((l) => l.key),
  );
}
