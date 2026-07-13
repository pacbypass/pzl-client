import React from 'react';
import { Tabs } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from 'react-native-paper';

function icon(name: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name as never} color={color} size={size} />
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{ title: 'Mapa', tabBarIcon: icon('map') }}
      />
      <Tabs.Screen
        name="hunting-book"
        options={{ title: 'Polowania', tabBarIcon: icon('target') }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: 'Plan', tabBarIcon: icon('chart-donut') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: icon('account') }}
      />
      {/* Module menu stays navigable (from Profile) but is not a primary tab. */}
      <Tabs.Screen name="(menu)" options={{ href: null }} />
    </Tabs>
  );
}
