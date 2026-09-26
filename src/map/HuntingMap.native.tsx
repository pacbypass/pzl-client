import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import {
  Camera,
  CircleLayer,
  FillLayer,
  LineLayer,
  MapView,
  ShapeSource,
  SymbolLayer,
  UserLocation,
} from '@maplibre/maplibre-react-native';
import { buildMapStyle, type VectorOverlay } from '@/map/style';
import { POLAND_CENTER } from '@/map/layers';
import type { MapCamera } from '@/map/HuntingMap';

export type HuntingMapProps = {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  initialCamera?: MapCamera | null;
  onCameraChange?: (camera: MapCamera) => void;
  showUserLocation?: boolean;
  flyTo?: MapCamera | null;
  onMapPress?: (coord: { longitude: number; latitude: number }) => void;
  /** Coordinate of the currently-selected device, highlighted with a ring. */
  highlight?: { longitude: number; latitude: number } | null;
  trackTo?: { longitude: number; latitude: number; zoom?: number } | null;
  onUserMove?: (camera: MapCamera) => void;
};

/** Native map via @maplibre/maplibre-react-native (v10, named exports). */
export function HuntingMap({
  activeRasterKeys,
  vectorOverlays,
  initialCamera,
  onCameraChange,
  showUserLocation,
  flyTo,
  onMapPress,
  highlight,
  trackTo,
  onUserMove,
}: HuntingMapProps) {
  const highlightShape = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: highlight
        ? [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [highlight.longitude, highlight.latitude] },
              properties: {},
            },
          ]
        : [],
    }),
    [highlight],
  );
  // The base style holds ONLY the raster layers — no vector data. Vector
  // overlays are drawn as ShapeSource children below, so when the hunting data
  // refetches the sources update in place WITHOUT reloading the whole style.
  // (Baking data into the style meant every refetch reloaded the map and reset
  // the camera to the last programmatic target — the "keeps flying back to me"
  // bug after using locate.) Only depends on the raster keys, which change
  // rarely (base-layer toggle).
  const style = useMemo(() => buildMapStyle(activeRasterKeys, []), [activeRasterKeys]);
  const cam = initialCamera ?? POLAND_CENTER;

  return (
    <MapView
      style={styles.map}
      mapStyle={style}
      // Compass so the user can see orientation and tap to reset north.
      compassEnabled
      compassViewPosition={0}
      compassViewMargins={{ x: 12, y: 12 }}
      onPress={(feature) => {
        const g = feature.geometry as GeoJSON.Point;
        if (g?.type === 'Point') {
          const [longitude, latitude] = g.coordinates;
          onMapPress?.({ longitude, latitude });
        }
      }}
      onRegionDidChange={(feature) => {
        const [longitude, latitude] = feature.geometry.coordinates;
        const camera = { longitude, latitude, zoom: feature.properties.zoomLevel };
        onCameraChange?.(camera);
        if (feature.properties.isUserInteraction) onUserMove?.(camera);
      }}
    >
      {/* Declarative camera. When `flyTo` is set the camera animates to it; when
          the parent clears `flyTo` (right after the animation) the control props
          go undefined, which CLEARS the native camera "stop" and hands gesture
          control back to the user. Driving this imperatively left a sticky stop
          that kept snapping the map back to the located point until restart. */}
      <Camera
        defaultSettings={{
          centerCoordinate: [cam.longitude, cam.latitude],
          zoomLevel: cam.zoom,
        }}
        // Follow-me (trackTo) eases to each new fix and leaves the zoom alone
        // unless one is given; flyTo is the one-shot jump. MapLibre's own
        // user tracking was tried and dropped: it cancelled itself about half
        // a second after starting.
        centerCoordinate={
          trackTo
            ? [trackTo.longitude, trackTo.latitude]
            : flyTo
              ? [flyTo.longitude, flyTo.latitude]
              : undefined
        }
        zoomLevel={trackTo ? trackTo.zoom : flyTo ? flyTo.zoom : undefined}
        animationMode={trackTo ? 'easeTo' : flyTo ? 'flyTo' : undefined}
        animationDuration={trackTo ? 900 : flyTo ? 800 : undefined}
      />

      {vectorOverlays.map((ov) =>
        ov.kind === 'polygon' ? (
          <ShapeSource key={ov.key} id={`geo-${ov.key}`} shape={ov.data as GeoJSON.FeatureCollection}>
            {/* Plain paint per overlay. The taken rewiry come through as their
                OWN overlay (red, stronger fill) drawn over the plain ones, so
                the highlight never rides on a data-driven expression. */}
            <FillLayer
              id={`geo-${ov.key}-fill`}
              style={{
                fillColor: ov.color,
                fillOpacity: ov.fillOpacity ?? 0.12,
              }}
            />
            <LineLayer
              id={`geo-${ov.key}-line`}
              style={{
                lineColor: ov.color,
                lineWidth: ov.lineWidth ?? 2,
              }}
            />
            {ov.labelKeys?.length ? (
              <SymbolLayer
                id={`geo-${ov.key}-label`}
                style={{
                  textField: ['coalesce', ...ov.labelKeys.map((k) => ['get', k]), ''] as never,
                  textFont: ['Noto Sans Regular'],
                  // Larger, bolder-reading labels (rewir/obwód numbers) so they're
                  // legible at a glance.
                  textSize: 18,
                  textColor: ov.color,
                  textHaloColor: '#ffffff',
                  textHaloWidth: 2,
                  symbolPlacement: 'point',
                }}
              />
            ) : null}
          </ShapeSource>
        ) : (
          <ShapeSource key={ov.key} id={`geo-${ov.key}`} shape={ov.data as GeoJSON.FeatureCollection}>
            <CircleLayer
              id={`geo-${ov.key}-circle`}
              style={{
                circleRadius: ov.circleRadius ?? 6,
                circleColor: ['coalesce', ['get', 'color'], ov.color] as never,
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 2,
              }}
            />
          </ShapeSource>
        ),
      )}

      {/* Selection highlight — a ring drawn ON TOP of the device markers so the
          user sees exactly which one they tapped. */}
      {highlight ? (
        <ShapeSource id="selected-device" shape={highlightShape}>
          <CircleLayer
            id="selected-device-ring"
            style={{
              circleRadius: 13,
              circleColor: '#1565c0',
              circleOpacity: 0.2,
              circleStrokeColor: '#1565c0',
              circleStrokeWidth: 3,
            }}
          />
        </ShapeSource>
      ) : null}

      {/* Follow-me marker, drawn on top of everything: the native puck sits
          under the overlays, so inside a taken rewir's red fill only its
          heading arrow showed — no good for finding yourself while driving.
          Mounted when following starts, so its layer is added last (on top). */}
      {trackTo ? (
        <ShapeSource
          id="follow-me"
          shape={{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [trackTo.longitude, trackTo.latitude] },
            properties: {},
          }}
        >
          <CircleLayer
            id="follow-me-dot"
            style={{
              circleRadius: 9,
              circleColor: '#1565c0',
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 3,
              circlePitchAlignment: 'map',
            }}
          />
        </ShapeSource>
      ) : null}

      {/* Native render mode draws the standard puck WITH the GPS accuracy ring
          (the "you might be here" circle) and a heading arrow, and keeps
          refining it as the fix improves. */}
      {showUserLocation ? (
        <UserLocation visible renderMode="native" showsUserHeadingIndicator />
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
