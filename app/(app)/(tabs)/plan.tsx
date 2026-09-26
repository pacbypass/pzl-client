import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Card,
  Menu,
  ProgressBar,
  Surface,
  Text,
  useTheme,
  type MD3Theme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectivityBanner, DataAge } from '@/components/offline';
import { EmptyState, ErrorState, LoadingScreen } from '@/components/ui';
import { planTotals, usePlanExecution, type PlanRowView } from '@/features/plan/api';
import {
  useHuntingDistrictOptions,
  useHuntingYears,
} from '@/features/huntingBook/lookups';
import { useUnits } from '@/units/UnitProvider';

function pctColor(pct: number, theme: MD3Theme): string {
  if (pct >= 1) return theme.colors.error;
  if (pct >= 0.75) return '#2E7D32';
  if (pct >= 0.4) return '#f9a825';
  return theme.colors.primary;
}

export default function PlanScreen() {
  const theme = useTheme();
  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';

  const years = useHuntingYears();
  const districts = useHuntingDistrictOptions(unitId);

  const [yearSel, setYearSel] = useState<number>();
  const [districtSel, setDistrictSel] = useState<string>();
  const [yearMenu, setYearMenu] = useState(false);
  const [distMenu, setDistMenu] = useState(false);

  // Defaults: the "actual" hunting year and the first district.
  const year =
    yearSel ?? years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value;
  // A pick from another koło (switched in the menu) is not an obwód of this
  // one; fall back to the first, as on a fresh open.
  const districtId =
    districtSel && (!districts.data || districts.data.some((d) => d.id === districtSel))
      ? districtSel
      : districts.data?.[0]?.id;
  const yearLabel =
    years.data?.find((y) => y.value === year)?.label ?? (year ? String(year) : '—');
  const districtLabel =
    districts.data?.find((d) => d.id === districtId)?.label ?? '—';

  const query = usePlanExecution(unitId, year, districtId);
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const totals = planTotals(rows);

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
          <Appbar.Content title="Realizacja planu" subtitle="Roczny plan łowiecki" />
          <Appbar.Action icon="refresh" onPress={() => query.refetch()} disabled={query.isFetching} />
        </Appbar.Header>
        <View style={styles.selectors}>
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
                  setDistrictSel(d.id);
                  setDistMenu(false);
                }}
              />
            ))}
          </Menu>
          <View style={styles.age}>
            <DataAge updatedAt={query.dataUpdatedAt} isFetching={query.isFetching} />
          </View>
        </View>
        <ConnectivityBanner />
      </View>

      {query.isLoading ? (
        <LoadingScreen label="Wczytywanie planu…" />
      ) : query.isError && rows.length === 0 ? (
        <ErrorState error={query.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon="chart-donut" title="Brak danych planu" subtitle="Wybierz rok i obwód." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r, i) => `${r.label}-${i}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
          }
          ListHeaderComponent={
            <Surface style={styles.summary} elevation={1}>
              <Text variant="labelMedium" style={styles.summaryLabel}>
                REALIZACJA OGÓŁEM
              </Text>
              <Text variant="displaySmall" style={styles.summaryPct}>
                {Math.round(totals.pct * 100)}%
              </Text>
              <ProgressBar
                progress={Math.min(1, totals.pct)}
                color={pctColor(totals.pct, theme)}
                style={styles.summaryBar}
              />
              <Text variant="bodyMedium" style={styles.summaryDetail}>
                Pozyskano {totals.harvested} z {totals.planned} · pozostało {totals.remaining}
              </Text>
            </Surface>
          }
          renderItem={({ item }) => <PlanRowCard row={item} />}
        />
      )}
    </View>
  );
}

function PlanRowCard({ row }: { row: PlanRowView }) {
  const theme = useTheme();
  const color = pctColor(row.pct, theme);
  return (
    <Card style={styles.card} mode="contained">
      <Card.Content style={styles.cardContent}>
        <View style={styles.rowBetween}>
          <Text variant="titleSmall" style={styles.species}>
            {row.label}
          </Text>
          <Text variant="titleSmall" style={{ color, fontWeight: '700' }}>
            {Math.round(row.pct * 100)}%
          </Text>
        </View>
        <ProgressBar progress={Math.min(1, row.pct)} color={color} style={styles.bar} />
        <View style={styles.statsRow}>
          <Stat label="Plan" value={row.planned} />
          <Stat label="Pozyskano" value={row.harvested} />
          <Stat label="Pozostało" value={row.remaining} />
        </View>
      </Card.Content>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text variant="titleMedium" style={styles.statValue}>
        {value}
      </Text>
      <Text variant="labelSmall" style={styles.statLabel}>
        {label}
      </Text>
    </View>
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
  list: { padding: 12, gap: 10 },
  summary: { borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 6 },
  summaryLabel: { opacity: 0.6, letterSpacing: 1 },
  summaryPct: { fontWeight: '800', marginVertical: 4 },
  summaryBar: { width: '100%', height: 10, borderRadius: 6, marginVertical: 8 },
  summaryDetail: { opacity: 0.8 },
  card: { borderRadius: 14 },
  cardContent: { gap: 8, paddingVertical: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  species: { fontWeight: '700', flex: 1 },
  bar: { height: 8, borderRadius: 5 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontWeight: '700' },
  statLabel: { opacity: 0.6 },
});
