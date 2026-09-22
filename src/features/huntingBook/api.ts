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

function normalizeList(data: unknown): HuntEntry[] {
  // Live API wraps lists as { result, total }; older/other shapes use { content }.
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { result?: unknown[] })?.result)
      ? (data as { result: unknown[] }).result
      : Array.isArray((data as { content?: unknown[] })?.content)
        ? (data as { content: unknown[] }).content
        : [];
  return arr
    .map((raw) => {
      const o = { ...(raw as Record<string, unknown>) };
      if (o.id != null) o.id = String(o.id); // ids may come back numeric
      const parsed = HuntEntrySchema.safeParse(o);
      return parsed.success ? parsed.data : null;
    })
    .filter((x): x is HuntEntry => x !== null);
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

/**
 * A hunting permit ("upoważnienie") held by the current user, from
 * `/authorizations/me?year=`. Each is tied to one hunting district; the sign-up
 * form only offers those matching the chosen obwód.
 */
export type MyAuthorization = {
  id: number;
  number: string; // e.g. "17/185/26-27"
  huntingDistrictId: number;
  huntingDistrictNumber?: string;
  startDate?: string;
  endDate?: string;
  statusName?: string;
  /** Set once the hunter handed the permit back — it is spent from then on. */
  returnDate?: string;
  /** A prolonged permit's new end date; it wins over `endDate`. */
  extendedToDate?: string;
  /** Printed but not handed out yet. */
  isUnreleased?: boolean;
  /** Blocked in eKEP. */
  isEkepBlock?: boolean;
};

/**
 * Can this permit still be hunted on today?
 *
 * `/authorizations/me?year=` returns the WHOLE season — including permits that
 * were already returned and have run out. The live account carries 3 per obwód
 * that way while the vendor app offers 2, the third being e.g. "17/185/26-27"
 * (endDate 2026-08-31, returnDate 2026-08-30). Filtering on these fields
 * reproduces the vendor's list exactly: it yields the same ids as
 * `/persons/hunters/{id}/permits`, the pre-filtered endpoint the app uses when
 * booking somebody else.
 *
 * `status`/`statusName` do NOT discriminate — a returned permit is still
 * "W"/"Wydane" — so the dates are what decide.
 */
export function isCurrentPermit(
  p: MyAuthorization,
  now: Date = new Date(),
): boolean {
  if (p.returnDate) return false;
  if (p.isUnreleased === true) return false;
  if (p.isEkepBlock === true) return false;
  // Dates come as plain "YYYY-MM-DD", so compare them as such — no timezone
  // shifting a permit in or out of validity around midnight.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const end = (p.extendedToDate ?? p.endDate)?.slice(0, 10);
  if (end && end < today) return false;
  const start = p.startDate?.slice(0, 10);
  if (start && start > today) return false;
  return true;
}

export function useMyAuthorizations(unitId: string, year: number | undefined) {
  return useQuery({
    queryKey: ['authorizations', 'me', unitId, year],
    enabled: !!unitId && !!year,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const data = await apiRequest(endpoints.authorizations(unitId).mine, {
        query: { year },
      });
      const arr = Array.isArray(data)
        ? data
        : ((data as { result?: unknown[] })?.result ?? []);
      return arr
        .map((r) => r as Record<string, unknown>)
        .filter((r) => r.id != null)
        .map(
          (r): MyAuthorization => ({
            id: Number(r.id),
            number: String(r.number ?? r.id),
            huntingDistrictId: Number(r.huntingDistrictId),
            huntingDistrictNumber: r.huntingDistrictNumber
              ? String(r.huntingDistrictNumber)
              : undefined,
            startDate: r.startDate ? String(r.startDate) : undefined,
            endDate: r.endDate ? String(r.endDate) : undefined,
            statusName: r.statusName ? String(r.statusName) : undefined,
            returnDate: r.returnDate ? String(r.returnDate) : undefined,
            extendedToDate: r.extendedToDate ? String(r.extendedToDate) : undefined,
            isUnreleased: r.isUnreleased === true,
            isEkepBlock: r.isEkepBlock === true,
          }),
        );
    },
  });
}

/**
 * Permits held by ANOTHER hunter — for booking someone else ("Inny myśliwy").
 * `/persons/hunters/{hunterId}/permits` → `[{id, number, huntingDistrictId}]`.
 * Same {id} shape as the self permits, so the sign-up form treats both alike.
 *
 * This endpoint is already filtered SERVER-side to the permits that are valid
 * now (verified against a hunter whose season list holds returned ones too), so
 * the rows carry no dates — `isCurrentPermit` passes them through unchanged.
 */
export function useHunterPermits(unitId: string, hunterId: string | undefined) {
  return useQuery({
    queryKey: ['hunterPermits', unitId, hunterId],
    enabled: !!unitId && !!hunterId,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const data = await apiRequest(
        endpoints.hunters(unitId).permits(hunterId as string),
      );
      const arr = Array.isArray(data)
        ? data
        : ((data as { result?: unknown[] })?.result ?? []);
      return arr
        .map((r) => r as Record<string, unknown>)
        .filter((r) => r.id != null)
        .map(
          (r): MyAuthorization => ({
            id: Number(r.id),
            number: String(r.number ?? r.id),
            huntingDistrictId: Number(r.huntingDistrictId),
            huntingDistrictNumber: r.huntingDistrictNumber
              ? String(r.huntingDistrictNumber)
              : undefined,
          }),
        );
    },
  });
}

/** Rewiry (sub-sectors) of a hunting district, as {id, name} picker options. */
export type RewirOption = { id: string; name: string };

export function useRewirOptions(unitId: string, districtId: string | undefined) {
  return useQuery({
    queryKey: ['rewirOptions', unitId, districtId],
    enabled: !!unitId && !!districtId,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      const data = await apiRequest(
        `/units/${unitId}/hunting-districts/grounds/all?districtIds=${encodeURIComponent(
          districtId as string,
        )}`,
      );
      const arr = Array.isArray(data)
        ? data
        : ((data as { result?: unknown[] })?.result ?? []);
      return arr
        .map((r) => r as Record<string, unknown>)
        .map((r): RewirOption => ({
          id: String(r.huntingGroundId ?? r.id ?? ''),
          name: String(r.name ?? ''),
        }))
        .filter((o) => o.id)
        .sort((a, b) =>
          a.name.localeCompare(b.name, 'pl', { numeric: true }),
        );
    },
  });
}

export function useActiveHunts(unitId: string, year: number | undefined) {
  return useQuery({
    queryKey: [...huntingBookKeys.active(unitId), year],
    enabled: !!unitId && !!year,
    queryFn: async () => {
      // `/huntings/me?year=` — the current user's hunting entries for the season.
      const data = await apiRequest(endpoints.huntingBook(unitId).mine, {
        query: { year },
      });
      return normalizeList(data);
    },
    select: (entries) => entries.filter(isEntryActive),
  });
}

export type SignUpInput = {
  unitId: string;
  /** true when booking someone else ("Inny myśliwy"). */
  anotherHunter: boolean;
  /** Person id of the hunter: self = token `person_id`, other = selected. */
  hunterId: number;
  hunterName?: string;
  huntingDistrictId?: string;
  huntingDistrictName?: string;
  /** Selected permits ("upoważnienia") — server field `permitIds` (bare ids). */
  permitIds: number[];
  permitLabel?: string; // for the optimistic row (e.g. "17/185/26-27")
  /** Rewir (sub-sector) ids → server field `huntingGroundIds`. */
  huntingGroundIds: number[];
  huntingPlaceName?: string; // e.g. "17"
  startTimestamp: string;
  endTimestamp: string;
  notes?: string;
  /**
   * "Potwierdzam uzyskanie zgody innych myśliwych na wspólne korzystanie z
   * wskazanego rewiru." Required by the server when the chosen rewir is already
   * OCCUPIED ("Zgoda myśliwych jest wymagana gdy chcesz skorzystać z zajętego
   * rewiru!"). Nothing to do with booking another hunter — must be the user's
   * own explicit choice, never auto-asserted.
   */
  confirmOtherHuntersConsent: boolean;
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
        id: `local:${input.startTimestamp}:${input.hunterId}`,
        hunterId: String(input.hunterId),
        hunterName: input.hunterName ?? 'Ja',
        huntingDistrictId: input.huntingDistrictId,
        huntingDistrictName: input.huntingDistrictName,
        standNumber: input.huntingPlaceName
          ? `Rewir: ${input.huntingPlaceName}`
          : undefined,
        startTimestamp: input.startTimestamp,
        endTimestamp: input.endTimestamp,
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
      // The książka list is a separate infinite query (['book', unitId, …]) —
      // invalidate it too so the freshly created hunt appears with the real
      // server flags rather than only after the 2-min staleTime elapses.
      qc.invalidateQueries({ queryKey: ['book', unitId] });
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
