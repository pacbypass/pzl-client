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

/**
 * UNFINISHED — the entry still holds its rewir. True for a hunt in progress, for
 * one that is over its time but was never written out, AND for one that is only
 * signed up for later today (`isStarted: false`): the rewir is booked from the
 * moment the entry exists, which is what the map has to show. False only once
 * the entry is written out (`checkoutPersonFullname` / `isEnded`) or crossed
 * out. Verified against the live book, where every finished entry carries a
 * checkout name and a not-yet-started one carries none.
 */
export function isOpenHunt(e: BookEntry): boolean {
  if (isCrossedOut(e)) return false;
  if (e.checkoutPersonFullname) return false;
  if (e.isEnded === true) return false;
  return true;
}

/** Signed up, but the hunt has not begun yet. */
export function isUpcoming(e: BookEntry): boolean {
  if (e.isStarted === true) return false;
  const start = Date.parse(e.startDate ?? '');
  return !Number.isNaN(start) && start > Date.now();
}

/**
 * Rewir labels from a hunt's `huntingPlace` string.
 *   "Rewir: 13 C"              → ["13 C"]
 *   "Rewir: 2"                 → ["2"]
 *   "Rewir: 2 A, 3b"           → ["2 A", "3b"]
 *   "Rewir: 17 (Ambona A-4)"   → ["17"]   (bracketed detail is not the rewir)
 * A rewir label is NOT always a number — the live API names them "13 C", "2 A",
 * "3b" — so the whole label is kept and only compared through `normalizeRewir`.
 */
export function rewirNames(huntingPlace?: string | null): string[] {
  if (!huntingPlace) return [];
  const afterColon = huntingPlace.split(':').slice(1).join(':');
  const body = (afterColon || huntingPlace).split('(')[0];
  return [
    ...new Set(
      body
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** First rewir of a hunt, or null when the place names none. */
export function rewirName(huntingPlace?: string | null): string | null {
  return rewirNames(huntingPlace)[0] ?? null;
}

/**
 * Comparison form of a rewir label. The book writes "13 C" while the map layer
 * may carry "13C", and one obwód mixes "3 A" with "3b" — so matching ignores
 * case and spacing.
 */
export function normalizeRewir(name: string): string {
  return name.replace(/\s+/g, '').toUpperCase();
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
 * Entries per request. The server defaults to 10 and accepts anything (500+
 * simply returns the whole season), so this is a bandwidth choice, not a limit.
 * Measured against a 446-entry season: 50 → 119KB/560ms, 100 → 240KB/660ms,
 * 200 → 470KB/900ms, all → 874KB/1.1s. 100 cuts requests tenfold while
 * halving what 200 would pull down — and since the list shows ~5 rows, one
 * page is already twenty screens of scrolling. Raise it here if you would
 * rather trade signal for round trips.
 */
export const BOOK_PAGE_SIZE = 100;

/**
 * Paginated book — 1-indexed `page` of BOOK_PAGE_SIZE entries,
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
  return fetchBookPage(unitId, districtId, year, 1);
}

/** One page of a district book (1-indexed, newest entry first). */
export async function fetchBookPage(
  unitId: string,
  districtId: string | undefined,
  year: number | undefined,
  page: number,
): Promise<BookPage> {
  const data = await apiRequest(
    `/units/${unitId}/hunting-districts/${districtId}/huntings`,
    { query: { year, page, itemsPerPage: BOOK_PAGE_SIZE } },
  );
  return { ...parseEntries(data), page };
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
        { query: { year, page: pageParam, itemsPerPage: BOOK_PAGE_SIZE } },
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
