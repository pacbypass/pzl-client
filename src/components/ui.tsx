import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, Text, useTheme } from 'react-native-paper';

export function LoadingScreen({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
      <ActivityIndicator size="large" />
      {label ? (
        <Text variant="bodyMedium" style={styles.mt}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  subtitle,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.center}>
      <Text variant="titleMedium" style={styles.mt}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="bodySmall" style={[styles.mt, styles.muted]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd';
  return (
    <View style={styles.center}>
      <Text variant="titleMedium">Błąd</Text>
      <Text variant="bodySmall" style={[styles.mt, styles.muted]}>
        {message}
      </Text>
    </View>
  );
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#9e9e9e',
  PLANNED: '#1976D2',
  APPROVED: '#2E7D32',
  ACTIVE: '#2E7D32',
  CANCELLED: '#c62828',
  REJECTED: '#c62828',
  SETTLED: '#6a1b9a',
  NEW: '#f57c00',
};

export function StatusChip({ status }: { status?: string }) {
  if (!status) return null;
  const color = STATUS_COLORS[status.toUpperCase()] ?? '#607d8b';
  return (
    <Chip
      compact
      style={{ backgroundColor: color + '22' }}
      textStyle={{ color, fontSize: 12 }}
    >
      {status}
    </Chip>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  mt: { marginTop: 8, textAlign: 'center' },
  muted: { opacity: 0.6 },
});
