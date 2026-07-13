import { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

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
      retry: 2,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'pzl.query-cache',
  throttleTime: 1000,
});
