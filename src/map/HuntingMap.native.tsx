import React, { useMemo, useRef } from 'react';
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
  UserTrackingMode,
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
  /** Keep the camera centred on the user as they move (follow-me). */
  followUser?: boolean;
  /** Zoom the map goes to when following starts. */
  followZoom?: number;
  /** Following stopped (or started) on the map's side — e.g. the user panned. */
  onFollowUserChange?: (following: boolean) => void;
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
  followUser,
  followZoom,
  onFollowUserChange,
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
  // Only the FIRST camera: the screen saves every camera move back into
  // `initialCamera`, and a changing default made MapLibre re-apply it —
  // which, among other things, cancelled follow-me the moment it moved.
  const cam = useRef(initialCamera ?? POLAND_CENTER).current;

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
        onCameraChange?.({
          longitude,
          latitude,
          zoom: feature.properties.zoomLevel,
        });
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
        centerCoordinate={flyTo && !followUser ? [flyTo.longitude, flyTo.latitude] : undefined}
        zoomLevel={flyTo && !followUser ? flyTo.zoom : undefined}
        animationMode={flyTo && !followUser ? 'flyTo' : undefined}
        animationDuration={flyTo && !followUser ? 800 : undefined}
        // Follow-me, north up. MapLibre's own tracking: it keeps the dot
        // centred as fixes arrive, a pinch zooms about it, and a pan ends it —
        // reported back so the button can switch off.
        followUserLocation={!!followUser}
        followUserMode={UserTrackingMode.Follow}
        followZoomLevel={followUser ? followZoom : undefined}
        onUserTrackingModeChange={(e) =>
          onFollowUserChange?.(e.nativeEvent.payload.followUserLocation)
        }
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
