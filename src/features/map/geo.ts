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

// These layers change rarely; cache long and let the persisted cache serve them
// offline. `staleTime` high so we don't refetch in the field unless asked.
const GEO_QUERY_OPTS = {
  staleTime: 1000 * 60 * 60 * 24, // 1 day
  gcTime: 1000 * 60 * 60 * 24 * 60, // 60 days — survive long offline stints
} as const;

export function useDistrictsGeo(unitId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['geo', 'districts', unitId],
    enabled: !!unitId && enabled,
    ...GEO_QUERY_OPTS,
    queryFn: async () =>
      toFeatureCollection(await apiRequest(endpoints.geo(unitId).huntingDistrictsMap)),
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
