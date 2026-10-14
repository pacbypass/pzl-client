import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openHuntsIn, refreshBook, useCachedBooks } from '@/features/huntingBook/sharedBook';
import {
  huntStatus,
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
 * The data is the Polowania tab's own hunt lists (sharedBook): showing the map
 * makes sure EVERY obwód of the koło is loaded there, so the highlight is
 * right even if the user never opened that tab, and both panels always show
 * the same data with the same age.
 */

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
 * Currently-taken rewiry across every obwód of the koło, read from the SHARED
 * hunt lists (see sharedBook): the same cache entries the Polowania tab shows,
 * so both panels agree on what is happening and how fresh it is, and a refresh
 * in either one updates both. `enabled` follows the map layer toggle.
 *
 * Returns a query-like handle (refetch / isStale / isFetching / timestamps),
 * since that is what the map screen drives its refreshes and messages with.
 */
export function useOccupiedRewirs(
  unitId: string,
  year: number | undefined,
  districts: Option[],
  enabled: boolean,
) {
  const qc = useQueryClient();
  const districtIds = useMemo(() => districts.map((d) => d.id), [districts]);
  const books = useCachedBooks(qc, unitId, districtIds, year);
  const [isFetching, setFetching] = useState(false);
  const [errorUpdatedAt, setErrorUpdatedAt] = useState(0);
  const ready = !!unitId && !!year && districtIds.length > 0 && enabled;

  const refetch = useCallback(async () => {
    if (!ready) return;
    setFetching(true);
    try {
      // Each obwód on its own: one that fails keeps its last known list
      // (refreshBook never empties it), so a lost connection can never read
      // as "nobody is hunting".
      const results = await Promise.allSettled(
        districtIds.map((d) =>
          refreshBook(qc, unitId, d, year as number, { coverOpenHunts: true }),
        ),
      );
      if (results.some((r) => r.status === 'rejected')) setErrorUpdatedAt(Date.now());
    } finally {
      setFetching(false);
    }
  }, [ready, qc, unitId, year, districtIds]);

  // First view of an obwód nobody has loaded yet: fetch it.
  const missing = ready && books.some((b) => !b.data);
  useEffect(() => {
    if (missing) void refetch();
    // Only when a list is missing; refreshes are otherwise the screen's call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  // The age of the oldest list shown — what the map's data is as old as.
  const dataUpdatedAt =
    books.length > 0 && books.every((b) => b.dataUpdatedAt > 0)
      ? Math.min(...books.map((b) => b.dataUpdatedAt))
      : 0;

  const rows = useMemo<OpenHunt[]>(
    () =>
      books.flatMap((b, i) =>
        openHuntsIn(b.data).map((entry) => ({ districtId: districtIds[i], entry })),
      ),
    [books, districtIds],
  );
  const { rewirs, unplaced } = useMemo(() => toRewirs(rows, districts), [rows, districts]);

  const query = {
    refetch,
    isFetching,
    isStale: !dataUpdatedAt || Date.now() - dataUpdatedAt > OCCUPIED_STALE_MS,
    dataUpdatedAt,
    errorUpdatedAt,
    data: books.some((b) => b.data) ? rows : undefined,
  };

  return { query, rewirs, unplaced };
}
