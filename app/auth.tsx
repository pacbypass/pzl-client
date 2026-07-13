import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingScreen } from '@/components/ui';

/**
 * OAuth redirect target (web). The code exchange runs in AuthProvider's mount
 * effect; this screen just shows a spinner and forwards once it resolves.
 */
export default function AuthCallback() {
  const { ready, isAuthenticated } = useAuth();
  if (ready && isAuthenticated) return <Redirect href="/(app)/(tabs)/map" />;
  if (ready && !isAuthenticated) return <Redirect href="/login" />;
  return <LoadingScreen label="Kończenie logowania…" />;
}
