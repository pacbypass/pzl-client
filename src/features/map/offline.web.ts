import type { LngLat, OfflineResult } from './offline';

// On web there is no offline pack API; the browser HTTP cache serves already
// viewed tiles, and vector overlays are cached via the persisted query cache.
export const OFFLINE_DOWNLOAD_SUPPORTED = false;

export async function downloadOfflineArea(
  _style: object,
  _bounds: [LngLat, LngLat],
  _name: string,
): Promise<OfflineResult> {
  return {
    ok: false,
    message:
      'Pobieranie obszaru offline jest dostępne w aplikacji mobilnej. W przeglądarce mapa korzysta z pamięci podręcznej.',
  };
}
