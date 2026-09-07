import { z } from 'zod';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

/**
 * Książka ewidencji polowań (per hunting district).
 *   GET /units/{u}/hunting-districts/{districtId}/huntings?year=
 *   → { result: [ { number, startDate, endDate, leadingPersonFullname,
 *                   huntingPlace, isStarted, isEnded, permitNumber } ] }
 */
const HarvestedAnimalSchema = z
  .object({
    animalName: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    animalTypeName: z.string().nullable().optional(),
    amount: z.number().nullable().optional(),
    quantity: z.number().nullable().optional(),
    sex: z.string().nullable().optional(),
  })
  .passthrough();

export const BookEntrySchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    number: z.union([z.string(), z.number()]).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    leadingPersonFullname: z.string().nullable().optional(),
    leadingPersonId: z.union([z.string(), z.number()]).nullable().optional(),
    huntingPlace: z.string().nullable().optional(),
    huntingDistrictId: z.union([z.string(), z.number()]).nullable().optional(),
    permitNumber: z.string().nullable().optional(),
    checkinPersonFullname: z.string().nullable().optional(),
    checkoutPersonFullname: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    shotsFired: z.number().nullable().optional(),
    // The LIST endpoint returns `animals` as a COMMA-JOINED NAME STRING
    // (e.g. "Lis, Lis"); the DETAIL endpoint returns an array of objects. Accept
    // both — declaring only the array silently dropped every hunt WITH harvest
    // (safeParse failed → filtered out), so they never appeared in the list.
    animals: z
      .union([z.string(), z.array(HarvestedAnimalSchema)])
      .nullable()
      .optional(),
    withWoundedAnimals: z.boolean().optional(),
    isStarted: z.boolean().optional(),
    isEnded: z.boolean().optional(),
    isApproved: z.boolean().optional(),
    // Entry status — a BOOLEAN: false ⟺ the entry was crossed out ("wykreślone").
    // Verified against the live API: a normal hunt (active/overdue/closed) is
    // status:true, a crossed-out one is status:false (both endpoints carry it).
    status: z.union([z.boolean(), z.string(), z.number()]).nullable().optional(),
    statusName: z.string().nullable().optional(),
  })
  .passthrough();

export type BookEntry = z.infer<typeof BookEntrySchema>;
export type HarvestedAnimal = z.infer<typeof HarvestedAnimalSchema>;

/** Human-readable list of harvested animals on an entry. Handles both shapes:
 *  the list's comma-joined string and the detail's array of objects. */
export function harvestedNames(e: BookEntry): string[] {
  const a = e.animals;
  if (!a) return [];
  if (typeof a === 'string') {
    return a.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return a.map((x) => {
    const name = x.animalName ?? x.animalTypeName ?? x.name ?? 'zwierzyna';
    const qty = x.amount ?? x.quantity;
    return qty && qty > 1 ? `${name} ×${qty}` : name;
  });
}

/**
 * Was this entry crossed out ("wykreślone")? — the hunter deleted their sign-up
 * (vendor: `DELETE …/huntings/{id}`, "Wykreśl polowanie"). The API marks it with
 * the boolean `status`: false ⟺ crossed out. Verified live against a crossed-out
 * hunt (status:false) vs. every normal one (status:true).
 */
export function isCrossedOut(e: BookEntry): boolean {
  return e.status === false;
}

/** Display status of a hunt — the single source of truth for label + colour. */
export type HuntStatus = 'crossed' | 'closed' | 'overdue' | 'active';

export function huntStatus(e: BookEntry): HuntStatus {
  // crossed → grey + strikethrough; closed (someone wrote out) → grey;
  // past its end but nobody wrote out → red (overdue); otherwise → green.
  if (isCrossedOut(e)) return 'crossed';
  if (e.checkoutPersonFullname) return 'closed';
  const now = Date.now();
  const end = e.endDate ? Date.parse(e.endDate) : NaN;
  if (!Number.isNaN(end) && end < now) return 'overdue';
  return 'active';
}

/** Currently in the field: booked in and not yet booked out (green OR red). */
export function isCurrentlyHunting(e: BookEntry): boolean {
  const s = huntStatus(e);
  return s === 'active' || s === 'overdue';
}

/** Rewir number from a hunt's `huntingPlace` string ("Rewir: 17" → "17"). */
export function rewirName(huntingPlace?: string | null): string | null {
  if (!huntingPlace) return null;
  const m = huntingPlace.match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

function parseEntries(data: unknown): { entries: BookEntry[]; total: number } {
  const d = data as { result?: unknown[]; total?: number };
  const arr = Array.isArray(data) ? data : (d?.result ?? []);
  const entries = arr
    .map((r) => {
      const p = BookEntrySchema.safeParse(r);
      return p.success ? p.data : null;
    })
    .filter((x): x is BookEntry => x !== null);
  return { entries, total: d?.total ?? entries.length };
}

/**
 * Paginated book — the endpoint returns 10 entries/page (1-indexed `page`),
 * newest-first (entry number descending), plus a `total`. Infinite scroll
 * fetches the next page; a background refetch re-pulls the loaded pages so
 * updates to already-listed (older) hunts are picked up.
 */
/** Query key for the district book — exported so a refresh can truncate the
 *  cached pages (progressive refresh). */
export const bookKey = (
  unitId: string,
  districtId: string | undefined,
  year: number | undefined,
) => ['book', unitId, districtId, year] as const;

export type BookPage = { entries: BookEntry[]; total: number; page: number };

/**
 * Fetch ONLY page 1 of a district book — used for the lightweight "update the
 * newest page" refresh (on open / pull-to-refresh) that leaves the other loaded
 * pages untouched, so it costs a single request.
 */
export async function fetchBookPage1(
  unitId: string,
  districtId: string | undefined,
  year: number | undefined,
): Promise<BookPage> {
  const data = await apiRequest(
    `/units/${unitId}/hunting-districts/${districtId}/huntings`,
    { query: { year, page: 1 } },
  );
  return { ...parseEntries(data), page: 1 };
}

export function useDistrictBook(
  unitId: string,
  districtId: string | undefined,
  year: number | undefined,
) {
  return useInfiniteQuery({
    queryKey: bookKey(unitId, districtId, year),
    enabled: !!unitId && !!districtId && !!year,
    initialPageParam: 1,
    // Never auto-refetch (minimise requests): the list refreshes only via the
    // page-1 refresh (open / pull) or the full reload button — see the screen.
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    queryFn: async ({ pageParam }) => {
      const data = await apiRequest(
        `/units/${unitId}/hunting-districts/${districtId}/huntings`,
        { query: { year, page: pageParam } },
      );
      return { ...parseEntries(data), page: pageParam as number };
    },
    getNextPageParam: (lastPage, allPages) => {
      // Guard against pages rehydrated from an older cache shape (no `entries`).
      const loaded = allPages.reduce((s, p) => s + (p?.entries?.length ?? 0), 0);
      const lastCount = lastPage?.entries?.length ?? 0;
      const total = lastPage?.total ?? 0;
      const page = lastPage?.page ?? allPages.length;
      return lastCount > 0 && loaded < total ? page + 1 : undefined;
    },
  });
}
