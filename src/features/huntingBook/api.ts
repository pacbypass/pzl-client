import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/**
 * Individual hunting entry ("wpis w książce ewidencji polowań" / LOW-1).
 * Field names taken from the reversed Zod schemas (huntingDistrictId, hunterId,
 * startTimestamp, animalTypeId, standId, status/isActive …).
 */
export const HuntEntrySchema = z
  .object({
    id: z.string(),
    hunterId: z.string().optional(),
    hunterName: z.string().optional(),
    huntingDistrictId: z.string().optional(),
    huntingDistrictName: z.string().optional(),
    huntingDistrictNumber: z.string().optional(),
    standId: z.string().optional(),
    standNumber: z.string().optional(),
    animalTypeId: z.string().optional(),
    animalTypeName: z.string().optional(),
    startTimestamp: z.string().optional(),
    endTimestamp: z.string().nullable().optional(),
    status: z.string().optional(),
    statusName: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

export type HuntEntry = z.infer<typeof HuntEntrySchema> & {
  /** Local-only markers for offline optimistic entries. */
  _pending?: boolean;
  _localOnly?: boolean;
};

const ListSchema = z.union([
  z.array(HuntEntrySchema),
  z.object({ content: z.array(HuntEntrySchema) }).passthrough(),
]);

function normalizeList(data: unknown): HuntEntry[] {
  const parsed = ListSchema.safeParse(data);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.content;
}

export function isEntryActive(e: HuntEntry): boolean {
  if (e.isActive != null) return e.isActive;
  if (e.endTimestamp) return false;
  const s = (e.status ?? '').toUpperCase();
  if (s) return ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'STARTED'].includes(s);
  return !e.endTimestamp;
}

export const huntingBookKeys = {
  active: (unitId: string) => ['huntingBook', 'active', unitId] as const,
};

export function useActiveHunts(unitId: string) {
  return useQuery({
    queryKey: huntingBookKeys.active(unitId),
    enabled: !!unitId,
    queryFn: async () => {
      const data = await apiRequest(endpoints.huntingBook(unitId).huntings, {
        query: { active: true },
      });
      return normalizeList(data);
    },
    select: (entries) => entries.filter(isEntryActive),
  });
}

export type SignUpInput = {
  unitId: string;
  hunterId?: string; // omit => self (solo sign-up)
  hunterName?: string;
  huntingDistrictId?: string;
  huntingDistrictName?: string;
  standId?: string;
  standNumber?: string;
  animalTypeId?: string;
  animalTypeName?: string;
  startTimestamp: string;
};

export type EndHuntInput = {
  unitId: string;
  id: string;
  endTimestamp: string;
};

/** Mutation keys — the server call for these is registered as a default in
 *  registerMutationDefaults so paused (offline) mutations survive a restart
 *  and resume on reconnect. */
export const huntMutationKeys = {
  signUp: ['huntingBook', 'signUp'] as const,
  endHunt: ['huntingBook', 'endHunt'] as const,
};

export function useSignUpHunt(unitId: string) {
  const qc = useQueryClient();
  return useMutation<HuntEntry, unknown, SignUpInput, { previous?: HuntEntry[] }>({
    mutationKey: huntMutationKeys.signUp,
    onMutate: async (input) => {
      const key = huntingBookKeys.active(unitId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<HuntEntry[]>(key);
      const optimistic: HuntEntry = {
        id: `local:${input.startTimestamp}:${input.hunterId ?? 'self'}`,
        hunterId: input.hunterId,
        hunterName: input.hunterName ?? 'Ja',
        huntingDistrictId: input.huntingDistrictId,
        huntingDistrictName: input.huntingDistrictName,
        standId: input.standId,
        standNumber: input.standNumber,
        animalTypeId: input.animalTypeId,
        animalTypeName: input.animalTypeName,
        startTimestamp: input.startTimestamp,
        isActive: true,
        status: 'ACTIVE',
        _pending: true,
        _localOnly: true,
      };
      qc.setQueryData<HuntEntry[]>(key, [...(previous ?? []), optimistic]);
      return { previous };
    },
    onError: (_e, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(huntingBookKeys.active(unitId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: huntingBookKeys.active(unitId) });
    },
  });
}

export function useEndHunt(unitId: string) {
  const qc = useQueryClient();
  return useMutation<HuntEntry, unknown, EndHuntInput, { previous?: HuntEntry[] }>({
    mutationKey: huntMutationKeys.endHunt,
    onMutate: async (input) => {
      const key = huntingBookKeys.active(unitId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<HuntEntry[]>(key);
      qc.setQueryData<HuntEntry[]>(
        key,
        (previous ?? []).map((e) =>
          e.id === input.id
            ? { ...e, endTimestamp: input.endTimestamp, isActive: false, _pending: true }
            : e,
        ),
      );
      return { previous };
    },
    onError: (_e, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(huntingBookKeys.active(unitId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: huntingBookKeys.active(unitId) });
    },
  });
}
