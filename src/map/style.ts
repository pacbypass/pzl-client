import {
  BASE_LAYERS,
  OVERLAY_LAYERS,
  wmsTileTemplate,
  type RasterLayer,
} from '@/map/layers';
import type { FeatureCollection } from '@/features/map/geo';

/** Fill/outline of a rewir that is currently taken ("zajęty"). */
export const OCCUPIED_COLOR = '#c62828';

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
      // A feature tagged `occupied` (a rewir someone is hunting in right now)
      // paints red; everything else uses the overlay's own colour. Mirrors the
      // native renderer's paint so both platforms show the same thing.
      const occupied = ['==', ['get', 'occupied'], true];
      layers.push({
        id: `${src}-fill`,
        type: 'fill',
        source: src,
        paint: {
          'fill-color': ['case', occupied, OCCUPIED_COLOR, ov.color],
          'fill-opacity': ['case', occupied, 0.4, 0.12],
        },
      });
      layers.push({
        id: `${src}-line`,
        type: 'line',
        source: src,
        paint: {
          'line-color': ['case', occupied, OCCUPIED_COLOR, ov.color],
          'line-width': ['case', occupied, 3, 2],
        },
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
            // The glyphs endpoint below serves these fontstacks; without an
            // explicit font the native renderer requests one it can't fetch and
            // the labels silently disappear.
            'text-font': ['Noto Sans Regular'],
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
          // Per-feature `color` (e.g. device type) if present, else the layer color.
          'circle-color': ['coalesce', ['get', 'color'], ov.color],
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
