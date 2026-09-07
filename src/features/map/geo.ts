import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/** Minimal GeoJSON typing — we pass whatever the server returns straight to MapLibre. */
export type FeatureCollection = {
  type: 'FeatureCollection';
  features: unknown[];
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Accepts a FeatureCollection, a bare feature array, or {data|geojson} wrappers. */
function toFeatureCollection(data: unknown): FeatureCollection {
  if (!data) return EMPTY;
  const d = data as Record<string, unknown>;
  if (d.type === 'FeatureCollection' && Array.isArray(d.features)) {
    return d as unknown as FeatureCollection;
  }
  if (Array.isArray(data)) return { type: 'FeatureCollection', features: data };
  for (const k of ['geojson', 'data', 'features', 'content']) {
    const v = d[k];
    if (v) return toFeatureCollection(v);
  }
  return EMPTY;
}

// Map layers update ONLY when the user taps the reload button — never on their
// own. staleTime:Infinity + no refetch-on-mount/reconnect means the data loads
// once (first time a layer is shown) and then stays put until an explicit
// refetch() from the reload button. Persisted cache serves them offline.
const GEO_QUERY_OPTS = {
  staleTime: Infinity,
  gcTime: 1000 * 60 * 60 * 24 * 60, // 60 days — survive long offline stints
  refetchOnMount: false,
  refetchOnReconnect: false,
} as const;

/** Build a polygon FeatureCollection from the district list, each of which
 *  carries a GeoJSON `geometry` (MultiPolygon, lng/lat). */
function districtsToGeo(data: unknown): FeatureCollection {
  // Demo/legacy already returns a FeatureCollection.
  const d = data as Record<string, unknown>;
  if (d?.type === 'FeatureCollection') return toFeatureCollection(data);
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(d?.result)
      ? (d.result as unknown[])
      : [];
  const features = rows
    .map((r) => r as Record<string, unknown>)
    .filter((r) => r.geometry && typeof r.geometry === 'object')
    .map((r) => ({
      type: 'Feature' as const,
      geometry: r.geometry,
      properties: { number: String(r.number ?? ''), id: r.id },
    }));
  return { type: 'FeatureCollection', features };
}

export function useDistrictsGeo(
  unitId: string,
  year: number | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['geo', 'districts', unitId, year],
    enabled: !!unitId && !!year && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () => {
      // Each district in this list carries its own polygon `geometry`.
      const data = await apiRequest(`/units/${unitId}/hunting-districts`, {
        query: { year },
      });
      return districtsToGeo(data);
    },
  });
}

/**
 * Rewiry (sub-sectors of the obwody) — each a polygon with a `name` (rewir
 * number) and `color`. `/units/{u}/hunting-districts/grounds/all?districtIds=…`
 * (districtIds repeated, one per district).
 */
export function useRewirsGeo(
  unitId: string,
  districtIds: string[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['geo', 'rewirs', unitId, [...districtIds].sort().join(',')],
    enabled: !!unitId && districtIds.length > 0 && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () => {
      const qs = districtIds
        .map((id) => `districtIds=${encodeURIComponent(id)}`)
        .join('&');
      const data = await apiRequest<unknown>(
        `/units/${unitId}/hunting-districts/grounds/all?${qs}`,
      );
      const arr = Array.isArray(data)
        ? data
        : ((data as { result?: unknown[] })?.result ?? []);
      return {
        type: 'FeatureCollection',
        features: arr
          .map((g) => g as Record<string, unknown>)
          .filter((g) => g.geometry && typeof g.geometry === 'object')
          .map((g) => {
            // The API ships a ready-made `centerPoint` per rewir — used to fly
            // the camera to one picked from the occupied list.
            const c = (g.centerPoint as { coordinates?: number[] } | undefined)
              ?.coordinates;
            return {
              type: 'Feature' as const,
              geometry: g.geometry,
              properties: {
                // NOT always a number — the live API names rewiry "13 C", "3b".
                name: String(g.name ?? ''),
                color: (g.color as string) ?? '#007fff',
                // Which obwód the rewir belongs to — rewir labels repeat across
                // obwody, so the occupied-highlight needs it to tell them apart.
                districtId: String(g.huntingDistrictId ?? g.districtId ?? ''),
                centerLng: c?.[0],
                centerLat: c?.[1],
              },
            };
          }),
      } as FeatureCollection;
    },
  });
}

export function useDevicesGeo(unitId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geo', 'devices', unitId],
    enabled: !!unitId && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () =>
      toFeatureCollection(await apiRequest(endpoints.geo(unitId).huntingDevicesMap)),
  });
}

export function useStandsGeo(unitId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geo', 'stands', unitId],
    enabled: !!unitId && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () =>
      toFeatureCollection(await apiRequest(endpoints.geo(unitId).huntingStationsMap)),
  });
}

export function useGroundsGeo(unitId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geo', 'grounds', unitId],
    enabled: !!unitId && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () =>
      toFeatureCollection(await apiRequest(endpoints.geo(unitId).groundsMap)),
  });
}

/**
 * Rough centre of a polygon feature (mean of its positions) — good enough to
 * fly the camera to a rewir when the user taps it in a list.
 */
export function centroidOf(
  geometry: unknown,
): { longitude: number; latitude: number } | null {
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      sumLng += node[0] as number;
      sumLat += node[1] as number;
      n++;
      return;
    }
    for (const child of node) walk(child);
  };
  walk((geometry as { coordinates?: unknown })?.coordinates);
  return n ? { longitude: sumLng / n, latitude: sumLat / n } : null;
}
