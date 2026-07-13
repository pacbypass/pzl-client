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
      <PaperProvider theme={theme}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: 1000 * 60 * 60 * 24 * 30, // keep cached data for 30 days
            dehydrateOptions: {
              // Persist paused (offline) mutations so a queued sign-up/end
              // survives an app restart and flushes on reconnect.
              shouldDehydrateMutation: (m) => m.state.isPaused,
            },
          }}
          onSuccess={() => {
            // Cache restored → flush anything that was queued while offline.
            queryClient.resumePausedMutations();
          }}
        >
          <AuthProvider>
            <TokenBridge>
              <UnitProvider>{children}</UnitProvider>
            </TokenBridge>
          </AuthProvider>
        </PersistQueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
