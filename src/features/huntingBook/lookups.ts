import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

export type Option = { id: string; label: string; extra?: string };

function toOptions(
  data: unknown,
  idKeys: string[],
  labelKeys: string[],
): Option[] {
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { content?: unknown[] })?.content)
      ? (data as { content: unknown[] }).content
      : [];
  // The PZŁ dictionaries/pickers return `{ value, label }` (confirmed against
  // the live API), so `value`/`label` are always valid fallbacks.
  const ids = [...idKeys, 'value'];
  const labels = [...labelKeys, 'label'];
  return arr
    .map((raw) => {
      const o = raw as Record<string, unknown>;
      const id = ids.map((k) => o[k]).find((v) => v != null);
      const label = labels.map((k) => o[k]).find((v) => v != null);
      if (id == null) return null;
      return { id: String(id), label: label != null ? String(label) : String(id) };
    })
    .filter((x): x is Option => x !== null);
}

/** Members of the club (to book another hunter). Long cache — rarely changes. */
export function useHunterOptions(unitId: string) {
  return useQuery({
    queryKey: ['lookup', 'hunters', unitId],
    enabled: !!unitId,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const data = await apiRequest(endpoints.hunters(unitId).simpleList);
      return toOptions(
        data,
        ['id', 'hunterId', 'personId'],
        ['fullName', 'name', 'hunterName', 'label'],
      );
    },
  });
}

export function useHuntingDistrictOptions(unitId: string) {
  return useQuery({
    queryKey: ['lookup', 'districts', unitId],
    enabled: !!unitId,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const data = await apiRequest(endpoints.geo(unitId).huntingDistrictsSimple);
      return toOptions(
        data,
        ['id', 'huntingDistrictId'],
        ['name', 'number', 'huntingDistrictNumber', 'label'],
      );
    },
  });
}

export function useAnimalTypeOptions() {
  return useQuery({
    queryKey: ['lookup', 'animal-types'],
    staleTime: 1000 * 60 * 60 * 24,
    queryFn: async () => {
      const data = await apiRequest(endpoints.dictionaries.animalType);
      return toOptions(data, ['id', 'code'], ['name', 'label']);
    },
  });
}

export function useStandOptions(unitId: string) {
  return useQuery({
    queryKey: ['lookup', 'stands', unitId],
    enabled: !!unitId,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const data = await apiRequest(endpoints.geo(unitId).standsAll);
      return toOptions(
        data,
        ['id', 'standId'],
        ['number', 'standNumber', 'name', 'label'],
      );
    },
  });
}
