import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { UnitProvider } from '@/units/UnitProvider';
import { setTokenProvider } from '@/api/client';
import { darkTheme, lightTheme } from '@/theme/theme';
import { queryClient, asyncStoragePersister } from '@/offline/queryClient';
import { initOnlineManager } from '@/offline/connectivity';
import { registerMutationDefaults } from '@/offline/mutationDefaults';

// One-time wiring (module scope so it runs before the first render commit).
initOnlineManager();
registerMutationDefaults(queryClient);

/** Bridges the auth token getter into the API client. */
function TokenBridge({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = useAuth();
  useEffect(() => {
    setTokenProvider(getAccessToken);
  }, [getAccessToken]);
  return <>{children}</>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;

  return (
    <SafeAreaProvider>
      {/* QueryClient must be ABOVE PaperProvider: Paper's <Portal.Host> lives at
          the top of PaperProvider's subtree, so anything rendered in a <Portal>
          (dialogs) would otherwise sit outside the QueryClient and crash with
          "No QueryClient set" when it uses a query hook. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: asyncStoragePersister,
          // Bump when a cached query's data shape changes so stale entries
          // (e.g. old infinite-query pages) are discarded instead of crashing.
          buster: 'v2-book-pages',
          maxAge: 1000 * 60 * 60 * 24 * 30, // keep cached data for 30 days
          dehydrateOptions: {
            // NEVER persist mutations: an in-flight/failing write must NOT
            // survive an app restart. Only cached query DATA is persisted (for
            // offline reads); a POST/PUT that hasn't landed is dropped when the
            // app is killed, and the user re-issues it if still needed.
            shouldDehydrateMutation: () => false,
          },
        }}
        onSuccess={() => {
          // Cache (query data) restored. No mutations are persisted, so there is
          // nothing to resume here — writes live only for the current session.
        }}
      >
        <PaperProvider theme={theme}>
          <AuthProvider>
            <TokenBridge>
              <UnitProvider>{children}</UnitProvider>
            </TokenBridge>
          </AuthProvider>
        </PaperProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
