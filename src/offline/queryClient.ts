import { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ApiError } from '@/api/client';

/**
 * Query client tuned for field use (poor/no connectivity in the woods):
 * - long gcTime so cached data survives and stays available offline
 * - queries never marked stale purely by time (we show data age instead)
 * - mutations pause while offline and resume on reconnect (see registerMutationDefaults)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
      staleTime: 1000 * 60 * 5,
      // GETs are never retried. A failed read just leaves the last cached data
      // on screen (shown with its age) — we do NOT hammer the server for reads;
      // stale data in the field is acceptable. offlineFirst still serves the
      // persisted cache first, so offline reads render instantly.
      retry: false,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      // 'always' (not 'online'): the mutation FIRES and keeps retrying even when
      // the OS reports offline — so a POST/PUT literally hammers the network
      // every retryDelay until it lands, catching a one-second window of signal
      // without waiting for the connectivity manager. It is NOT paused/queued,
      // and (see AppProviders: shouldDehydrateMutation → false) NOT persisted, so
      // an in-flight write does NOT survive an app restart — killing the app
      // cancels it.
      networkMode: 'always',
      // Hammer until success: retry genuine network failures AND transient server
      // errors (5xx / 408 / 429) forever — safe because the server blocks
      // duplicate sign-ups, so a resent write can't double-book. Stop only on a
      // real client error (other 4xx — validation / permission / conflict), which
      // a retry can never fix.
      retry: (_count, error) => {
        if (error instanceof ApiError) {
          return (
            error.status >= 500 || error.status === 408 || error.status === 429
          );
        }
        return true; // network failure → keep trying
      },
      // Fixed 3s between attempts (no exponential backoff).
      retryDelay: 3000,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'pzl.query-cache',
  throttleTime: 1000,
});
