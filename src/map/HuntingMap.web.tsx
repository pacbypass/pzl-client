import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildMapStyle, type VectorOverlay } from '@/map/style';
import { POLAND_CENTER } from '@/map/layers';
import type { MapCamera } from '@/map/HuntingMap';

export type HuntingMapProps = {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  initialCamera?: MapCamera | null;
  onCameraChange?: (camera: MapCamera) => void;
};

/** Web map via maplibre-gl. */
export function HuntingMap({
  activeRasterKeys,
  vectorOverlays,
  initialCamera,
  onCameraChange,
}: HuntingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cbRef = useRef(onCameraChange);
  cbRef.current = onCameraChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const cam = initialCamera ?? POLAND_CENTER;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(activeRasterKeys, vectorOverlays) as maplibregl.StyleSpecification,
      center: [cam.longitude, cam.latitude],
      zoom: cam.zoom,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }));
    map.on('moveend', () => {
      const c = map.getCenter();
      cbRef.current?.({ longitude: c.lng, latitude: c.lat, zoom: map.getZoom() });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // setStyle with diff keeps the camera; rebuilds sources/layers on change.
  useEffect(() => {
    mapRef.current?.setStyle(
      buildMapStyle(activeRasterKeys, vectorOverlays) as maplibregl.StyleSpecification,
    );
  }, [activeRasterKeys, vectorOverlays]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
