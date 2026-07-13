import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Appbar,
  Button,
  Card,
  Divider,
  Icon,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectivityBanner, DataAge, PendingBadge } from '@/components/offline';
import { EmptyState, ErrorState, LoadingScreen } from '@/components/ui';
import {
  useActiveHunts,
  useEndHunt,
  type HuntEntry,
} from '@/features/huntingBook/api';
import { useUnits } from '@/units/UnitProvider';

function elapsedSince(iso?: string): string {
  if (!iso) return '';
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} godz. ${m} min` : `${m} min`;
}

function startClock(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export default function HuntingBookScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { activeUnitId } = useUnits();
  const query = useActiveHunts(activeUnitId ?? '');
  const endHunt = useEndHunt(activeUnitId ?? '');

  if (!activeUnitId) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <EmptyState title="Wybierz koło łowieckie" />
      </SafeAreaView>
    );
  }

  const data = query.data ?? [];

  const onEnd = (entry: HuntEntry) => {
    if (!activeUnitId) return;
    endHunt.mutate({
      unitId: activeUnitId,
      id: entry.id,
      endTimestamp: new Date().toISOString(),
    });
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']}>
        <Appbar.Header mode="small" elevated>
          <Appbar.Content
            title="Kto poluje"
            subtitle={`${data.length} trwających polowań`}
          />
          <Appbar.Action
            icon="refresh"
            onPress={() => query.refetch()}
            disabled={query.isFetching}
          />
        </Appbar.Header>
        <View style={styles.ageBar}>
          <DataAge updatedAt={query.dataUpdatedAt} isFetching={query.isFetching} />
        </View>
        <ConnectivityBanner />
      </SafeAreaView>

      {query.isLoading ? (
        <LoadingScreen label="Wczytywanie…" />
      ) : query.isError && data.length === 0 ? (
        <ErrorState error={query.error} />
      ) : data.length === 0 ? (
        <EmptyState
          icon="target"
          title="Nikt teraz nie poluje"
          subtitle="Zapisz siebie lub innego myśliwego, aby rozpocząć polowanie."
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => query.refetch()}
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card} mode="contained">
              <Card.Content style={styles.cardContent}>
                <View style={styles.rowBetween}>
                  <Text variant="titleMedium" style={styles.hunter}>
                    {item.hunterName ?? 'Myśliwy'}
                  </Text>
                  {item._pending ? <PendingBadge /> : null}
                </View>

                <View style={styles.metaRow}>
                  <Icon source="map-marker" size={16} color={theme.colors.primary} />
                  <Text variant="bodyMedium">
                    {item.huntingDistrictName ??
                      item.huntingDistrictNumber ??
                      'Obwód —'}
                    {item.standNumber ? ` · ambona ${item.standNumber}` : ''}
                  </Text>
                </View>
                {item.animalTypeName ? (
                  <View style={styles.metaRow}>
                    <Icon source="paw" size={16} color={theme.colors.primary} />
                    <Text variant="bodyMedium">{item.animalTypeName}</Text>
                  </View>
                ) : null}
                <View style={styles.metaRow}>
                  <Icon source="clock-outline" size={16} color={theme.colors.primary} />
                  <Text variant="bodyMedium">
                    od {startClock(item.startTimestamp)} · {elapsedSince(item.startTimestamp)}
                  </Text>
                </View>

                <Divider style={styles.divider} />
                <Button
                  mode="text"
                  icon="stop-circle-outline"
                  textColor={theme.colors.error}
                  onPress={() => onEnd(item)}
                  style={styles.endBtn}
                >
                  Zakończ polowanie
                </Button>
              </Card.Content>
            </Card>
          )}
        />
      )}

      <SafeAreaView edges={['bottom']} style={styles.actions}>
        <Button
          mode="contained-tonal"
          icon="account-plus"
          style={styles.actionBtn}
          onPress={() => router.push('/(app)/hunting-signup?mode=other' as never)}
        >
          Inny myśliwy
        </Button>
        <Button
          mode="contained"
          icon="target"
          style={styles.actionBtn}
          onPress={() => router.push('/(app)/hunting-signup?mode=self' as never)}
        >
          Zapisz się
        </Button>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  ageBar: { paddingHorizontal: 16, paddingBottom: 6 },
  list: { padding: 12, gap: 10 },
  card: { borderRadius: 16 },
  cardContent: { gap: 6, paddingVertical: 12 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hunter: { fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { marginTop: 8 },
  endBtn: { alignSelf: 'flex-start' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    paddingTop: 8,
  },
  actionBtn: { flex: 1, borderRadius: 12 },
});
