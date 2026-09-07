import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { FeatureCollection } from '@/features/map/geo';

/**
 * Hunting devices (urządzenia łowieckie): ambony, zwyżki, paśniki, lizawki…
 *   GET /units/{u}/hunting-tools/all?year=
 *   → [ { registerId, registerName, registerTypeId, registerTypeName,
 *         marker: { type:'Point', coordinates:[lng,lat] }, huntingDistrictId } ]
 */
export type Device = {
  registerId: number;
  registerName?: string;
  registerTypeId?: number;
  registerTypeName?: string;
  marker?: { type: string; coordinates: number[] } | null;
  huntingDistrictId?: number;
  number?: number;
  districtManagementName?: string;
};

export type DeviceType = { value: number; label: string };

// User priority: these show at the top of the filter, the rest below.
const PRIORITY = ['zwyżka', 'ambona'];

// Distinct colours per device type so markers are recognisable on the map.
const TYPE_COLORS: Record<number, string> = {
  34: '#1565c0', // Zwyżka  — blue
  3: '#e65100', // Ambona  — orange
  1: '#2e7d32', // Paśnik  — green
  2: '#6a1b9a', // Lizawka — purple
  50: '#00838f', // Chłodnia — teal
};
const DEFAULT_DEVICE_COLOR = '#455a64';

export function deviceColor(typeId?: number): string {
  return (typeId != null && TYPE_COLORS[typeId]) || DEFAULT_DEVICE_COLOR;
}

export function useDeviceTypes(unitId: string) {
  return useQuery({
    queryKey: ['deviceTypes', unitId],
    enabled: !!unitId,
    // Map data only refreshes on the reload button (see geo.ts GEO_QUERY_OPTS).
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const data = await apiRequest<DeviceType[]>(
        `/units/${unitId}/hunting-tools/dictionaries/types`,
      );
      const arr = Array.isArray(data) ? data : [];
      // Sort zwyżka/ambona first, then alphabetically.
      return [...arr].sort((a, b) => {
        const pa = PRIORITY.indexOf(a.label.toLowerCase());
        const pb = PRIORITY.indexOf(b.label.toLowerCase());
        if (pa !== -1 || pb !== -1) {
          return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        }
        return a.label.localeCompare(b.label, 'pl');
      });
    },
  });
}

export function useHuntingDevices(unitId: string, year: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['devices', unitId, year],
    enabled: !!unitId && !!year && enabled,
    // Map data only refreshes on the reload button.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24 * 30,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const data = await apiRequest<Device[]>(
        `/units/${unitId}/hunting-tools/all`,
        { query: { year } },
      );
      return Array.isArray(data) ? data : [];
    },
  });
}

/**
 * Devices actually shown on the map: those with valid coordinates and whose type
 * is in the current filter (empty selection = all types). Single source of truth
 * for "what's visible" — used both to draw the markers AND to resolve a tap, so a
 * tap can never select a device that's filtered out of view.
 */
export function visibleDevices(
  devices: Device[],
  selectedTypeIds: number[],
): Device[] {
  const set = new Set(selectedTypeIds);
  return devices
    .filter((d) => d.marker?.coordinates?.length === 2)
    .filter((d) => set.size === 0 || (d.registerTypeId != null && set.has(d.registerTypeId)));
}

/** Build a point FeatureCollection from the visible devices. */
export function devicesToGeo(
  devices: Device[],
  selectedTypeIds: number[],
): FeatureCollection {
  const features = visibleDevices(devices, selectedTypeIds)
    .map((d) => ({
      type: 'Feature' as const,
      geometry: d.marker,
      properties: {
        name: d.registerName ?? '',
        type: d.registerTypeName ?? '',
        typeId: d.registerTypeId ?? 0,
        color: deviceColor(d.registerTypeId),
      },
    }));
  return { type: 'FeatureCollection', features };
}
