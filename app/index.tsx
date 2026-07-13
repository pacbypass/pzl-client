import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingScreen } from '@/components/ui';

/** Auth gate: routes to login or the app shell. */
export default function Index() {
  const { ready, isAuthenticated } = useAuth();
  if (!ready) return <LoadingScreen label="Ładowanie…" />;
  return isAuthenticated ? (
    <Redirect href="/(app)/(tabs)/map" />
  ) : (
    <Redirect href="/login" />
  );
}
