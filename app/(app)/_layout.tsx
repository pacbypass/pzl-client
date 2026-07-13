import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingScreen } from '@/components/ui';

export default function AppLayout() {
  const { ready, isAuthenticated } = useAuth();
  if (!ready) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
