import { useRef, useSyncExternalStore } from 'react';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  bookKey,
  fetchBookPage,
  isOpenHunt,
  type BookEntry,
  type BookPage,
} from '@/features/huntingBook/book';

/**
 * ONE list of hunts per obwód, shared by every panel.
 *
 * The book tab and the map used to fetch the same książka separately, so they
 * disagreed about how fresh their data was and a refresh in one left the other
 * stale. Now both read the book's own cache entry (`bookKey`), and every
 * refresh — from whichever panel — goes through `refreshBook`, which writes
 * into that entry. React Query stamps it, so both panels show the same "Dane
 * z" time.
 */

/** At most this many pages are pulled in to cover still-open hunts. */
export const MAX_OPEN_PAGES = 6;
/** Open hunts are looked for in pages touched within this window. */
export const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function touchedAt(e: BookEntry): number {
  const start = Date.parse(e.startDate ?? '') || 0;
  const end = Date.parse(e.endDate ?? '') || 0;
  return Math.max(start, end);
}

/**
 * Whether paging should continue past `page` to find more open hunts: entries
 * come newest first and open ones cluster at the top, so a page with none (or
 * one entirely older than the lookback) means everything below is done.
 */
export function pageMayHaveMoreOpen(page: BookPage, loaded: number): boolean {
  if (!page.entries.length || loaded >= page.total) return false;
  if (!page.entries.some(isOpenHunt)) return false;
  const cutoff = Date.now() - LOOKBACK_MS;
  return page.entries.some((e) => touchedAt(e) >= cutoff);
}

/** Open hunts in a book, read with the same stopping rule the refresh uses. */
export function openHuntsIn(data: InfiniteData<BookPage> | undefined): BookEntry[] {
  const out: BookEntry[] = [];
  let loaded = 0;
  for (const [i, page] of (data?.pages ?? []).entries()) {
    if (!page?.entries) break;
    loaded += page.entries.length;
    out.push(...page.entries.filter(isOpenHunt));
    if (i + 1 >= MAX_OPEN_PAGES || !pageMayHaveMoreOpen(page, loaded)) break;
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inFlight = new Map<string, Promise<void>>();

/**
 * Refresh one obwód's book in the shared cache: page 1 again, and — when new
 * entries pushed older ones down — the other loaded pages too, so nothing
 * falls between pages. With `coverOpenHunts`, further pages are pulled in
 * while they may still hold open hunts (what the map needs to know who is
 * hunting). Concurrent refreshes of the same book share one run.
 *
 * Throws when the server cannot be reached; the cached list is then left
 * exactly as it was, never emptied.
 */
export async function refreshBook(
  qc: QueryClient,
  unitId: string,
  districtId: string,
  year: number,
  opts: { coverOpenHunts?: boolean } = {},
): Promise<void> {
  const key = bookKey(unitId, districtId, year);
  const id = JSON.stringify(key);
  const running = inFlight.get(id);
  if (running) {
    await running;
    // A plain refresh just finished; only extending it may still be needed.
    if (!opts.coverOpenHunts) return;
  }
  const run = (async () => {
    // A "load more" landing after this would write back the pages it started
    // from, undoing the refresh; let it finish first.
    for (let i = 0; i < 100 && qc.isFetching({ queryKey: key }) > 0; i++) await sleep(100);
    const before = qc.getQueryData<InfiniteData<BookPage>>(key);
    const page1 = await fetchBookPage(unitId, districtId, year, 1);
    const loaded = before?.pages.length ?? 0;
    let pages: BookPage[] = [page1];
    if (loaded > 1 && before) {
      const fresh = new Set(page1.entries.map((e) => e.id));
      const shifted =
        page1.total !== before.pages[0]?.total ||
        (before.pages[0]?.entries ?? []).some((e) => !fresh.has(e.id));
      if (shifted) {
        for (let p = 2; p <= loaded; p++) {
          pages.push(await fetchBookPage(unitId, districtId, year, p));
        }
      } else {
        pages = [page1, ...before.pages.slice(1)];
      }
    }
    if (opts.coverOpenHunts) {
      let count = pages.reduce((s, p) => s + p.entries.length, 0);
      while (
        pages.length < MAX_OPEN_PAGES &&
        pageMayHaveMoreOpen(pages[pages.length - 1], count)
      ) {
        const next = await fetchBookPage(unitId, districtId, year, pages.length + 1);
        pages.push(next);
        count += next.entries.length;
      }
    }
    qc.setQueryData<InfiniteData<BookPage>>(key, {
      pages,
      pageParams: pages.map((p) => p.page),
    });
  })();
  inFlight.set(id, run);
  try {
    await run;
  } finally {
    if (inFlight.get(id) === run) inFlight.delete(id);
  }
}

export type CachedBook = {
  data: InfiniteData<BookPage> | undefined;
  /** When this obwód's list was last written — the "Dane z" time. */
  dataUpdatedAt: number;
};

/**
 * Live view of several obwody's shared books, straight from the cache: it
 * re-renders whenever any panel refreshes one of them.
 */
export function useCachedBooks(
  qc: QueryClient,
  unitId: string,
  districtIds: string[],
  year: number | undefined,
): CachedBook[] {
  const cache = qc.getQueryCache();
  const last = useRef<{ sig: string; value: CachedBook[] } | null>(null);
  const getSnapshot = () => {
    const value = districtIds.map((d) => {
      const q = cache.find({ queryKey: bookKey(unitId, d, year), exact: true });
      return {
        data: q?.state.data as InfiniteData<BookPage> | undefined,
        dataUpdatedAt: q?.state.dataUpdatedAt ?? 0,
      };
    });
    const sig = `${unitId}|${year}|${districtIds.join(',')}|${value
      .map((v) => v.dataUpdatedAt)
      .join(',')}`;
    if (last.current?.sig === sig) return last.current.value;
    last.current = { sig, value };
    return value;
  };
  return useSyncExternalStore((onChange) => cache.subscribe(onChange), getSnapshot);
}
