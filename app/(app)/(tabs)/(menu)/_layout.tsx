import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from 'react-native-paper';

export default function MenuLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Menu' }} />
    </Stack>
  );
}
