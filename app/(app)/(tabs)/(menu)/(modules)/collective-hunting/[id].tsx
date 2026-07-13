import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Card, DataTable, Text, useTheme } from 'react-native-paper';
import { ErrorState, LoadingScreen, StatusChip } from '@/components/ui';
import { useCollectiveHunting } from '@/features/collectiveHuntings/api';
import { useUnits } from '@/units/UnitProvider';

export default function CollectiveHuntingDetail() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeUnitId } = useUnits();
  const query = useCollectiveHunting(activeUnitId ?? '', id ?? '');

  if (query.isLoading) return <LoadingScreen />;
  if (query.isError) return <ErrorState error={query.error} />;

  const h = query.data;
  if (!h) return <ErrorState error={new Error('Nie znaleziono polowania')} />;

  const rows: [string, string | undefined][] = [
    ['Numer', h.number],
    ['Obwód łowiecki', h.huntingDistrictName],
    ['Prowadzący', h.leaderName],
    ['Data', h.date ?? h.startDate],
    ['Zakończenie', h.endDate],
    ['Uczestnicy', h.participantsCount?.toString()],
  ];

  return (
    <>
      <Stack.Screen options={{ title: h.name ?? 'Polowanie zbiorowe' }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <Text variant="titleLarge" style={styles.title}>
            {h.name ?? `Polowanie ${h.number ?? h.id}`}
          </Text>
          <StatusChip status={h.status} />
        </View>

        <Card mode="outlined" style={styles.card}>
          <Card.Content>
            <DataTable>
              {rows
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <DataTable.Row key={label}>
                    <DataTable.Cell>{label}</DataTable.Cell>
                    <DataTable.Cell numeric>{value}</DataTable.Cell>
                  </DataTable.Row>
                ))}
            </DataTable>
          </Card.Content>
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { fontWeight: '700', flex: 1 },
  card: { borderRadius: 14 },
});
