import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { buildMapStyle, type VectorOverlay } from '@/map/style';
import type { OccupiedRewir } from '@/features/map/occupied';
import { useAuth } from '@/auth/AuthProvider';
import { loadCredentials, type Credentials } from '@/auth/tokenStore';
import { useUnits } from '@/units/UnitProvider';
import { config } from '@/config';
import {
  useHuntingDistrictOptions,
  useHuntingYears,
} from '@/features/huntingBook/lookups';

/**
 * Hands the map over to the ANDROID AUTO car app.
 *
 * The car app renders the very style this screen renders — same raster layers,
 * same obwód/rewir/occupied GeoJSON — so the style is published rather than
 * rebuilt in Kotlin; there is one definition of what the map looks like.
 *
 * `Paths.document` is the app's own `filesDir`, which is exactly where
 * `CarMapStore` reads `car-map.json`, so no native bridge is needed. Writing is
 * best-effort: a failure here must never disturb the phone map, and the car app
 * falls back to a plain OSM map when the file is missing.
 */
const FILE_NAME = 'car-map.json';
/** Don't rewrite a few hundred KB on every pan. */
const MIN_INTERVAL_MS = 4000;

export type CarMapMarker = {
  rewir: OccupiedRewir;
  longitude: number;
  latitude: number;
};

const OCCUPIED_PIN = '#c62828';

function fmtHunter(h: OccupiedRewir['hunters'][number]): string {
  const when = h.startDate
    ? new Date(h.startDate).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return (
    `${h.name} · ${h.upcoming ? 'zapisany od' : 'od'} ${when}` +
    (h.overdue ? ' · po czasie' : '')
  );
}

export function usePublishCarMap(input: {
  activeRasterKeys: Set<string>;
  vectorOverlays: VectorOverlay[];
  markers: CarMapMarker[];
  camera: { longitude: number; latitude: number; zoom: number } | null;
  /** Shown as the car app bar's subtitle, as on the phone. */
  unitName?: string | null;
  enabled: boolean;
}) {
  const lastWrite = useRef(0);
  const lastPayload = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { activeRasterKeys, vectorOverlays, markers, camera, unitName, enabled } = input;

  // What the car needs to talk to the API on its own — it must keep working
  // with the phone app closed, so it cannot depend on data the phone happens to
  // have cached. The token is written to the app's PRIVATE files directory
  // (same place the car reads the map from); it is excluded from backups by the
  // Android Auto config plugin.
  const { tokens } = useAuth();
  const { activeUnitId } = useUnits();
  // Whatever the user already chose to save for automatic re-login. When they
  // did not tick "zapamiętaj", nothing is published and the car falls back to
  // the published token until it expires.
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCredentials()
      .then((c) => {
        if (!cancelled) setCredentials(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tokens?.accessToken]);
  const years = useHuntingYears();
  const districts = useHuntingDistrictOptions(activeUnitId ?? '');
  const year =
    years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value ?? null;
  const token = tokens?.accessToken ?? null;
  const districtList = districts.data ?? [];

  useEffect(() => {
    // Only Android has a car app; the web build has no file system to speak of.
    if (Platform.OS !== 'android' || !enabled) return;

    const publish = () => {
      try {
        const payload = JSON.stringify({
          unit: unitName ?? null,
          api: {
            baseUrl: config.apiBaseUrl,
            token,
            expiresAt: tokens?.expiresAt ?? null,
            /**
             * The car signs in for itself when that token dies.
             *
             * This server issues NO refresh token (verified: a login returns
             * only access_token/id_token, `offline_access` is refused) and the
             * access token lasts ~25 minutes, so the only way for the car to
             * work with the phone app closed is to repeat the same headless
             * username/password login the phone does. The credentials are the
             * ones already saved on this device for automatic re-login; the
             * file lives in app-private storage and is outside cloud backup.
             */
            auth: credentials
              ? {
                  authIssuer: config.authIssuer,
                  clientId: config.oidc.web.clientId,
                  redirectUri: config.oidc.web.redirectUri,
                  scope: config.oidc.web.scopes.join(' '),
                  username: credentials.username,
                  password: credentials.password,
                  helpdesccode: credentials.helpdesccode ?? '',
                }
              : null,
            unitId: activeUnitId ?? null,
            year,
            districts: districtList.map((d) => ({ id: d.id, label: d.label })),
          },
          style: buildMapStyle(activeRasterKeys, vectorOverlays),
          camera: camera
            ? { lng: camera.longitude, lat: camera.latitude, zoom: camera.zoom }
            : null,
          markers: markers.map((m) => ({
            id: `${m.rewir.districtId}|${m.rewir.key}`,
            title: `Rewir ${m.rewir.name}`,
            subtitle: [
              `Obwód ${m.rewir.districtLabel}`,
              ...m.rewir.hunters.map(fmtHunter),
            ].join('\n'),
            lng: m.longitude,
            lat: m.latitude,
            color: OCCUPIED_PIN,
          })),
          updatedAt: Date.now(),
        });
        // `updatedAt` changes every time, so compare everything before it.
        const signature = payload.slice(0, payload.lastIndexOf('"updatedAt"'));
        if (signature === lastPayload.current) return;
        lastPayload.current = signature;
        lastWrite.current = Date.now();

        const file = new File(Paths.document, FILE_NAME);
        if (!file.exists) file.create({ overwrite: true });
        file.write(payload);
      } catch {
        // Never let the car hand-off break the map screen.
      }
    };

    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastWrite.current));
    timer.current = setTimeout(publish, wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    activeRasterKeys,
    vectorOverlays,
    markers,
    camera,
    unitName,
    enabled,
    token,
    credentials,
    activeUnitId,
    year,
    districtList,
  ]);
}
