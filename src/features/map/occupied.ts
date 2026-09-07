import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchBookPage,
  huntStatus,
  isOpenHunt,
  isUpcoming,
  normalizeRewir,
  rewirNames,
  type BookEntry,
} from '@/features/huntingBook/book';
import type { Option } from '@/features/huntingBook/lookups';

/**
 * "Które rewiry są teraz zajęte" — occupancy derived from the KSIĄŻKA EWIDENCJI
 * (the Polowania tab's data), not from a separate occupancy endpoint: a rewir is
 * taken while ANY UNFINISHED entry names it (`isOpenHunt`) — in progress, over
 * its time but never written out, or signed up for later today. It is free again
 * only once the hunter writes out (or crosses the entry out).
 *
 * The map owns this fetch: showing the map pulls the hunt data for EVERY obwód
 * of the koło, so the highlight is correct even if the user never opened the
 * Polowania tab (which only ever loads one obwód at a time).
 */

/** Hard cap on pages scanned per obwód, at 10 entries/page. */
const MAX_PAGES = 3;
/**
 * Entries come newest-first (entry number descending ≈ creation order) and open
 * ones cluster at the top, so paging stops as soon as a whole page holds none —
 * plus this hard age limit, so an off-season book (whose newest entries are
 * months old) costs a single request.
 */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Occupancy is time-sensitive, so unlike the static map layers it may refresh
 *  on its own — but at most this often (the map screen refetches when it is
 *  focused and this has expired; the reload button always refetches). */
export const OCCUPIED_STALE_MS = 5 * 60 * 1000;

/** An open hunt, tagged with the obwód whose book it came from. */
export type OpenHunt = { districtId: string; entry: BookEntry };

export type OccupiedHunter = {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  /** past its declared end but never written out */
  overdue: boolean;
  /** signed up, but the hunt has not started yet */
  upcoming: boolean;
};

export type OccupiedRewir = {
  /** Rewir label as the book writes it ("13 C"). */
  name: string;
  /** `normalizeRewir(name)` — what the map matches on. */
  key: string;
  /** Id of the obwód whose book this came from (a district-option id). */
  districtId: string;
  districtLabel: string;
  /**
   * Every id that may identify this rewir's obwód on the MAP side — the option
   * id we queried plus the entry's own `huntingDistrictId`. The two endpoints
   * are not guaranteed to name districts identically, so matching accepts
   * either.
   */
  districtKeys: string[];
  hunters: OccupiedHunter[];
};

function touchedAt(e: BookEntry): number {
  const start = Date.parse(e.startDate ?? '') || 0;
  const end = Date.parse(e.endDate ?? '') || 0;
  return Math.max(start, end);
}

/** Unfinished hunts in one district book (usually 1–2 requests). */
async function fetchOpenHunts(
  unitId: string,
  districtId: string,
  year: number,
): Promise<BookEntry[]> {
  const open: BookEntry[] = [];
  const cutoff = Date.now() - LOOKBACK_MS;
  let loaded = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = await fetchBookPage(unitId, districtId, year, page);
    loaded += p.entries.length;
    const found = p.entries.filter(isOpenHunt);
    open.push(...found);
    if (!p.entries.length || loaded >= p.total) break;
    // A full page with nothing open — everything below it was written out.
    if (!found.length) break;
    if (!p.entries.some((e) => touchedAt(e) >= cutoff)) break;
  }
  return open;
}

export const occupiedKey = (
  unitId: string,
  year: number | undefined,
  districtIds: string[],
) => ['occupiedRewirs', unitId, year, [...districtIds].sort().join(',')] as const;

function toRewirs(rows: OpenHunt[], districts: Option[]) {
  const byKey = new Map<string, OccupiedRewir>();
  let unplaced = 0;
  for (const { districtId, entry } of rows) {
    const names = rewirNames(entry.huntingPlace);
    if (!names.length) {
      // Booked in, but the entry names no rewir — nothing to paint, so it is
      // reported as a count instead of being silently dropped.
      unplaced++;
      continue;
    }
    const label =
      districts.find((d) => d.id === districtId)?.label ?? districtId;
    const keys = [districtId, entry.huntingDistrictId]
      .filter((v) => v != null && v !== '')
      .map(String);
    const hunter: OccupiedHunter = {
      id: entry.id,
      name: entry.leadingPersonFullname ?? 'Myśliwy',
      startDate: entry.startDate,
      endDate: entry.endDate,
      overdue: huntStatus(entry) === 'overdue',
      upcoming: isUpcoming(entry),
    };
    for (const name of names) {
      const rewirKey = normalizeRewir(name);
      const mapKey = `${districtId}|${rewirKey}`;
      const rec = byKey.get(mapKey);
      if (rec) {
        rec.hunters.push(hunter);
        for (const k of keys) if (!rec.districtKeys.includes(k)) rec.districtKeys.push(k);
      } else {
        byKey.set(mapKey, {
          name,
          key: rewirKey,
          districtId,
          districtLabel: label,
          districtKeys: [...new Set(keys)],
          hunters: [hunter],
        });
      }
    }
  }
  const rewirs = [...byKey.values()].sort(
    (a, b) =>
      a.districtLabel.localeCompare(b.districtLabel, 'pl', { numeric: true }) ||
      a.name.localeCompare(b.name, 'pl', { numeric: true }),
  );
  return { rewirs, unplaced };
}

/**
 * Currently-taken rewiry across every obwód of the koło. `districts` are the
 * obwód options (their labels end up on the list); `enabled` follows the map
 * layer toggle so the requests only happen when the layer is on.
 */
export function useOccupiedRewirs(
  unitId: string,
  year: number | undefined,
  districts: Option[],
  enabled: boolean,
) {
  const districtIds = useMemo(() => districts.map((d) => d.id), [districts]);

  const query = useQuery({
    queryKey: occupiedKey(unitId, year, districtIds),
    enabled: !!unitId && !!year && districtIds.length > 0 && enabled,
    staleTime: OCCUPIED_STALE_MS,
    gcTime: 1000 * 60 * 60 * 24 * 7, // keep the last view readable offline
    refetchOnReconnect: false,
    queryFn: async (): Promise<OpenHunt[]> => {
      const per = await Promise.all(
        districtIds.map(async (districtId) => {
          try {
            const entries = await fetchOpenHunts(unitId, districtId, year as number);
            return entries.map((entry) => ({ districtId, entry }));
          } catch {
            // One obwód failing must not blank out the others.
            return [] as OpenHunt[];
          }
        }),
      );
      return per.flat();
    },
  });

  const { rewirs, unplaced } = useMemo(
    () => toRewirs(query.data ?? [], districts),
    [query.data, districts],
  );

  return { query, rewirs, unplaced };
}
