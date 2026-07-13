import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from 'react-native-paper';

export default function ModulesLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: '#fff',
        headerBackTitle: 'Menu',
      }}
    />
  );
}
