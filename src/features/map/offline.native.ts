import { OfflineManager } from '@maplibre/maplibre-react-native';
import type { LngLat, OfflineResult } from './offline';

export const OFFLINE_DOWNLOAD_SUPPORTED = true;

/**
 * Persists a base-map region into MapLibre's offline database so the raster
 * background is available with no connectivity. The inline style is handed to
 * the native SDK via a data-URI style URL (createPack only takes a URL, not
 * inline JSON). Viewed tiles are additionally kept in the ambient cache, so
 * areas you've already panned over also work offline.
 */
export async function downloadOfflineArea(
  style: object,
  bounds: [LngLat, LngLat],
  name: string,
  minZoom = 8,
  maxZoom = 15,
): Promise<OfflineResult> {
  const styleURL =
    'data:application/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(style));

  // Remove any previous pack with this name so a retry doesn't wedge.
  await OfflineManager.deletePack(name).catch(() => {});

  return new Promise<OfflineResult>((resolve) => {
    let done = false;
    const finish = (r: OfflineResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };

    // Never spin forever — the pack keeps downloading in the background even
    // after we stop waiting.
    const timeout = setTimeout(
      () =>
        finish({
          ok: true,
          message:
            'Pobieranie w toku — obszar zapisuje się w tle. Odwiedzone kafelki są już dostępne offline.',
        }),
      30_000,
    );

    OfflineManager.createPack(
      { name, styleURL, bounds, minZoom, maxZoom },
      (_pack, status) => {
        if ((status?.percentage ?? 0) >= 100) {
          clearTimeout(timeout);
          finish({ ok: true, message: 'Obszar zapisany offline.' });
        }
      },
      (_pack, err) => {
        clearTimeout(timeout);
        finish({
          ok: false,
          message: `Nie udało się zapisać obszaru: ${String((err as Error)?.message ?? err)}`,
        });
      },
    ).catch((err: unknown) => {
      clearTimeout(timeout);
      finish({
        ok: false,
        message: `Nie udało się rozpocząć pobierania: ${String((err as Error)?.message ?? err)}`,
      });
    });
  });
}
