import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Appbar,
  Button,
  Card,
  Chip,
  FAB,
  Icon,
  Menu,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectivityBanner, DataAge } from '@/components/offline';
import { EmptyState, ErrorState, LoadingScreen } from '@/components/ui';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  bookKey,
  fetchBookPage1,
  harvestedNames,
  huntStatus,
  isCurrentlyHunting,
  useDistrictBook,
  type BookEntry,
  type BookPage,
} from '@/features/huntingBook/book';
import {
  useHuntingDistrictOptions,
  useHuntingYears,
} from '@/features/huntingBook/lookups';
import { useUnits } from '@/units/UnitProvider';

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HuntingBookScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';

  const years = useHuntingYears();
  const districts = useHuntingDistrictOptions(unitId);
  const [yearSel, setYearSel] = useState<number>();
  const [distSel, setDistSel] = useState<string>();
  const [yearMenu, setYearMenu] = useState(false);
  const [distMenu, setDistMenu] = useState(false);

  const year =
    yearSel ?? years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value;
  const districtId = distSel ?? districts.data?.[0]?.id;
  const yearLabel =
    years.data?.find((y) => y.value === year)?.label ?? (year ? String(year) : '—');
  const districtLabel =
    districts.data?.find((d) => d.id === districtId)?.label ?? '—';

  const query = useDistrictBook(unitId, districtId, year);
  const entries = useMemo(() => {
    // Dedupe by id: a page-1-only refresh can briefly overlap the next page
    // when a new entry shifts the offset boundary.
    const seen = new Set<string>();
    const out: BookEntry[] = [];
    for (const e of query.data?.pages.flatMap((p) => p?.entries ?? []) ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    return out;
  }, [query.data]);
  const total = query.data?.pages[0]?.total ?? entries.length;
  const activeCount = entries.filter(isCurrentlyHunting).length;

  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Lightweight refresh (on open + pull-to-refresh): re-fetch ONLY page 1 and
   * splice it into the cache, leaving the already-loaded later pages untouched.
   * One request — the newest hunts are on page 1, so this catches new/changed
   * entries without re-pulling everything.
   */
  const refreshLatest = useCallback(async () => {
    if (!unitId || !districtId || !year) return;
    const key = bookKey(unitId, districtId, year);
    // Nothing cached yet → the query fetches page 1 on its own; don't double-fetch.
    if (!qc.getQueryData<InfiniteData<BookPage>>(key)) return;
    if (refreshing) return;
    setRefreshing(true);
    try {
      const page1 = await fetchBookPage1(unitId, districtId, year);
      qc.setQueryData<InfiniteData<BookPage>>(key, (old) =>
        old && old.pages.length
          ? { ...old, pages: [page1, ...old.pages.slice(1)] }
          : old,
      );
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, qc, unitId, districtId, year]);

  /**
   * Full reload (top reload button only): re-fetch page 1 first (shows the
   * newest immediately), then reload every page the user had scrolled through,
   * spinner on until all are in.
   */
  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const key = bookKey(unitId, districtId, year);
      const pageCount = qc.getQueryData<InfiniteData<unknown>>(key)?.pages.length ?? 1;
      if (pageCount > 1) {
        qc.setQueryData<InfiniteData<unknown>>(key, (old) =>
          old
            ? { ...old, pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
            : old,
        );
      }
      await query.refetch();
      for (let i = 1; i < pageCount; i++) {
        const res = await query.fetchNextPage();
        if (!res.hasNextPage) break;
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, qc, unitId, districtId, year, query]);

  // On open (and when the obwód/rok changes) update just the newest page.
  const lastKey = useRef<string>('');
  useEffect(() => {
    const k = `${unitId}|${districtId}|${year}`;
    if (!districtId || !year || k === lastKey.current) return;
    lastKey.current = k;
    void refreshLatest();
  }, [unitId, districtId, year, refreshLatest]);

  if (!activeUnitId) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <EmptyState title="Wybierz koło łowieckie" />
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <View>
        <Appbar.Header mode="small" elevated>
          <Appbar.Content
            title="Książka ewidencji"
            subtitle={`${activeCount} na polowaniu · ${total} wpisów`}
          />
          <Appbar.Action icon="refresh" onPress={refreshAll} disabled={refreshing || query.isFetching} />
        </Appbar.Header>
        <View style={styles.selectors}>
          <Menu
            visible={distMenu}
            onDismiss={() => setDistMenu(false)}
            anchor={
              <Button compact mode="outlined" icon="map-marker" onPress={() => setDistMenu(true)}>
                Obwód {districtLabel}
              </Button>
            }
          >
            {(districts.data ?? []).map((d) => (
              <Menu.Item
                key={d.id}
                title={`Obwód ${d.label}`}
                onPress={() => {
                  setDistSel(d.id);
                  setDistMenu(false);
                }}
              />
            ))}
          </Menu>
          <Menu
            visible={yearMenu}
            onDismiss={() => setYearMenu(false)}
            anchor={
              <Button compact mode="outlined" icon="calendar" onPress={() => setYearMenu(true)}>
                {yearLabel}
              </Button>
            }
          >
            {(years.data ?? []).map((y) => (
              <Menu.Item
                key={y.value}
                title={y.label}
                onPress={() => {
                  setYearSel(y.value);
                  setYearMenu(false);
                }}
              />
            ))}
          </Menu>
          <View style={styles.age}>
            <DataAge updatedAt={query.dataUpdatedAt} isFetching={refreshing || query.isFetching} />
          </View>
        </View>
        <ConnectivityBanner />
      </View>

      {query.isLoading ? (
        <LoadingScreen label="Wczytywanie książki…" />
      ) : query.isError && entries.length === 0 ? (
        <ErrorState error={query.error} />
      ) : entries.length === 0 ? (
        <EmptyState icon="book-open-variant" title="Brak wpisów" subtitle="Dla wybranego obwodu i roku." />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator style={styles.footer} />
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshLatest}
            />
          }
          renderItem={({ item }) => (
            <BookRow
              entry={item}
              onPress={() =>
                router.push({
                  pathname: '/(app)/hunt-detail',
                  params: { entry: JSON.stringify(item) },
                } as never)
              }
            />
          )}
        />
      )}

      <FAB
        icon="plus"
        label="Zapisz się"
        onPress={() => router.push('/(app)/hunting-signup' as never)}
        style={styles.fab}
      />
    </View>
  );
}

function BookRow({ entry, onPress }: { entry: BookEntry; onPress: () => void }) {
  const theme = useTheme();
  const status = huntStatus(entry);
  const harvest = harvestedNames(entry);
  // Card background per status: green (active), clearly red (overdue). Crossed &
  // closed keep the DEFAULT card colour (grey) — no override.
  const cardBg =
    status === 'active'
      ? theme.colors.primaryContainer
      : status === 'overdue'
        ? '#ffb3ab'
        : undefined;
  return (
    <Card mode="contained" onPress={onPress} style={[styles.card, cardBg ? { backgroundColor: cardBg } : null]}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.rowBetween}>
          <Text
            variant="titleMedium"
            style={[
              styles.hunter,
              status === 'crossed' && styles.struck,
            ]}
          >
            {entry.leadingPersonFullname ?? 'Myśliwy'}
          </Text>
          {status === 'active' || status === 'overdue' ? (
            <Chip
              compact
              icon={status === 'overdue' ? 'clock-alert-outline' : 'target'}
              style={{ backgroundColor: status === 'overdue' ? '#c62828' : theme.colors.primary }}
              textStyle={{ color: '#fff', fontSize: 12 }}
            >
              {status === 'overdue' ? 'Po czasie' : 'Na polowaniu'}
            </Chip>
          ) : (
            <Text variant="labelSmall" style={styles.muted}>
              {status === 'crossed' ? 'wykreślone' : 'zakończone'}
            </Text>
          )}
        </View>
        {entry.huntingPlace ? (
          <View style={styles.metaRow}>
            <Icon source="map-marker" size={15} color={theme.colors.primary} />
            <Text variant="bodyMedium">{entry.huntingPlace}</Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Icon source="clock-outline" size={15} color={theme.colors.primary} />
          <Text variant="bodyMedium">
            {fmt(entry.startDate)} →{' '}
            {status === 'active' || status === 'overdue' ? 'trwa' : fmt(entry.endDate)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Icon source="paw" size={15} color={theme.colors.primary} />
          <Text variant="bodyMedium">
            {harvest.length ? harvest.join(', ') : 'Brak pozyskania'}
          </Text>
        </View>
        {entry.shotsFired != null ? (
          <View style={styles.metaRow}>
            <Icon source="target" size={15} color={theme.colors.primary} />
            <Text variant="bodyMedium">Oddane strzały: {entry.shotsFired}</Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Text variant="labelSmall" style={styles.muted}>
            Wpis nr {String(entry.number ?? '—')}
            {entry.permitNumber ? ` · upoważnienie ${entry.permitNumber}` : ''}
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  selectors: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexWrap: 'wrap',
  },
  age: { flex: 1, alignItems: 'flex-end' },
  // extra bottom padding so the FAB doesn't cover the last entry
  list: { padding: 12, gap: 10, paddingBottom: 88 },
  footer: { paddingVertical: 16 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  card: { borderRadius: 16 },
  cardContent: { gap: 5, paddingVertical: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hunter: { fontWeight: '700', flex: 1 },
  struck: { textDecorationLine: 'line-through', color: '#6b6b6b' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { opacity: 0.6 },
});
