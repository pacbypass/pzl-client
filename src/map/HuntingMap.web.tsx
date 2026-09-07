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
  showUserLocation?: boolean; // handled via GeolocateControl on web
  flyTo?: MapCamera | null;
  onMapPress?: (coord: { longitude: number; latitude: number }) => void;
};

/** Web map via maplibre-gl. */
export function HuntingMap({
  activeRasterKeys,
  vectorOverlays,
  initialCamera,
  onCameraChange,
  flyTo,
  onMapPress,
}: HuntingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cbRef = useRef(onCameraChange);
  cbRef.current = onCameraChange;
  const pressRef = useRef(onMapPress);
  pressRef.current = onMapPress;

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
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true, // accuracy circle + heading are on by default
      }),
    );
    map.on('moveend', () => {
      const c = map.getCenter();
      cbRef.current?.({ longitude: c.lng, latitude: c.lat, zoom: map.getZoom() });
    });
    map.on('click', (e) => {
      pressRef.current?.({ longitude: e.lngLat.lng, latitude: e.lngLat.lat });
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

  useEffect(() => {
    if (flyTo) mapRef.current?.flyTo({ center: [flyTo.longitude, flyTo.latitude], zoom: flyTo.zoom });
  }, [flyTo]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
