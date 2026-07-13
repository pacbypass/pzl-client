export type LngLat = [number, number];
export type OfflineResult = { ok: boolean; message: string };

/**
 * Download a base-map area for offline use.
 * `bounds` = [northEast, southWest] in [lng, lat].
 */
export declare function downloadOfflineArea(
  style: object,
  bounds: [LngLat, LngLat],
  name: string,
  minZoom?: number,
  maxZoom?: number,
): Promise<OfflineResult>;

export declare const OFFLINE_DOWNLOAD_SUPPORTED: boolean;
