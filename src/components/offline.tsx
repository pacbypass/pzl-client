import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Icon, Text, useTheme } from 'react-native-paper';
import { useIsOnline } from '@/offline/connectivity';

function relativePl(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 45) return 'przed chwilą';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.floor(h / 24);
  return `${d} dni temu`;
}

/** "Age of data" indicator — shows how stale the displayed data is. Ticks live. */
export function DataAge({
  updatedAt,
  isFetching,
}: {
  updatedAt?: number;
  isFetching?: boolean;
}) {
  const theme = useTheme();
  const online = useIsOnline();
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!updatedAt) {
    return (
      <View style={styles.row}>
        <Icon source="cloud-off-outline" size={14} color={theme.colors.error} />
        <Text variant="labelSmall" style={styles.muted}>
          Brak danych offline
        </Text>
      </View>
    );
  }

  const age = Date.now() - updatedAt;
  const stale = age > 1000 * 60 * 15;
  const color = isFetching
    ? theme.colors.primary
    : !online || stale
      ? theme.colors.tertiary ?? '#b26a00'
      : theme.colors.onSurfaceVariant;

  return (
    <View style={styles.row}>
      <Icon
        source={isFetching ? 'sync' : online ? 'cloud-check-outline' : 'cloud-off-outline'}
        size={14}
        color={color}
      />
      <Text variant="labelSmall" style={[styles.muted, { color }]}>
        {isFetching
          ? 'Aktualizowanie…'
          : `Dane z: ${relativePl(age)}${!online ? ' (offline)' : ''}`}
      </Text>
    </View>
  );
}

/** Top-of-screen banner shown while the device is offline. */
export function ConnectivityBanner() {
  const online = useIsOnline();
  return (
    <Banner
      visible={!online}
      icon="wifi-off"
      style={styles.banner}
    >
      Tryb offline — zmiany zostaną wysłane po ponownym połączeniu.
    </Banner>
  );
}

/** Small chip marking a locally-queued (not yet synced) item. */
export function PendingBadge() {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Icon source="cloud-upload-outline" size={14} color={theme.colors.tertiary ?? '#b26a00'} />
      <Text variant="labelSmall" style={{ color: theme.colors.tertiary ?? '#b26a00' }}>
        oczekuje na wysłanie
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  muted: { opacity: 0.8 },
  banner: { marginBottom: 4 },
});
