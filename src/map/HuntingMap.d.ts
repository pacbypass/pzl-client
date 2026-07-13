import type React from 'react';
import type { VectorOverlay } from '@/map/style';

export type MapCamera = { longitude: number; latitude: number; zoom: number };

export type HuntingMapProps = {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  initialCamera?: MapCamera | null;
  onCameraChange?: (camera: MapCamera) => void;
};

export declare function HuntingMap(props: HuntingMapProps): React.ReactElement;
