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
  /**
   * Follow-me: while set, the camera eases to this point (and to `zoom`, when
   * given) every time it changes. Clearing it hands the camera back.
   */
  trackTo?: { longitude: number; latitude: number; zoom?: number } | null;
};

export declare function HuntingMap(props: HuntingMapProps): React.ReactElement;
