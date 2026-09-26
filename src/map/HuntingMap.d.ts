import type React from 'react';
import type { VectorOverlay } from '@/map/style';

export type MapCamera = { longitude: number; latitude: number; zoom: number };

export type HuntingMapProps = {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  initialCamera?: MapCamera | null;
  onCameraChange?: (camera: MapCamera) => void;
  /** Show the user-location dot (only after location permission is granted). */
  showUserLocation?: boolean;
  /** When this changes, the camera animates to the given coordinate. */
  flyTo?: MapCamera | null;
  /** Fired when the user taps the map (used to select nearby features). */
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

export declare function HuntingMap(props: HuntingMapProps): React.ReactElement;
