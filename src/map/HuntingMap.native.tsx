import React from 'react';
import { StyleSheet } from 'react-native';
import { Camera, MapView, UserLocation } from '@maplibre/maplibre-react-native';
import { buildMapStyle, type VectorOverlay } from '@/map/style';
import { POLAND_CENTER } from '@/map/layers';
import type { MapCamera } from '@/map/HuntingMap';

export type HuntingMapProps = {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  initialCamera?: MapCamera | null;
  onCameraChange?: (camera: MapCamera) => void;
};

/** Native map via @maplibre/maplibre-react-native (v10, named exports). */
export function HuntingMap({
  activeRasterKeys,
  vectorOverlays,
  initialCamera,
  onCameraChange,
}: HuntingMapProps) {
  const style = buildMapStyle(activeRasterKeys, vectorOverlays);
  const cam = initialCamera ?? POLAND_CENTER;

  return (
    <MapView
      style={styles.map}
      mapStyle={style}
      onRegionDidChange={(feature) => {
        const [longitude, latitude] = feature.geometry.coordinates;
        onCameraChange?.({
          longitude,
          latitude,
          zoom: feature.properties.zoomLevel,
        });
      }}
    >
      <Camera
        defaultSettings={{
          centerCoordinate: [cam.longitude, cam.latitude],
          zoomLevel: cam.zoom,
        }}
      />
      <UserLocation visible />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
