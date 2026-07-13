import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Card, Divider, Text, useTheme } from 'react-native-paper';
import { EmptyState, ErrorState, LoadingScreen, StatusChip } from '@/components/ui';
import { useCollectiveHuntings } from '@/features/collectiveHuntings/api';
import { useUnits } from '@/units/UnitProvider';

export default function CollectiveHuntingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { activeUnitId } = useUnits();
  const query = useCollectiveHuntings(activeUnitId ?? '');

  if (!activeUnitId) return <EmptyState title="Wybierz koło łowieckie" />;
  if (query.isLoading) return <LoadingScreen label="Wczytywanie polowań…" />;
  if (query.isError) return <ErrorState error={query.error} />;

  const data = query.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Polowania zbiorowe' }} />
      {data.length === 0 ? (
        <EmptyState
          icon="account-group"
          title="Brak polowań zbiorowych"
          subtitle="Nie zaplanowano jeszcze żadnego polowania zbiorowego."
        />
      ) : (
        <FlatList
          style={{ backgroundColor: theme.colors.background }}
          contentContainerStyle={styles.list}
          data={data}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={Divider}
          renderItem={({ item }) => (
            <Card
              style={styles.card}
              mode="contained"
              onPress={() =>
                router.push(
                  `/(app)/(tabs)/(menu)/(modules)/collective-hunting/${item.id}` as never,
                )
              }
            >
              <Card.Title
                title={item.name ?? `Polowanie ${item.number ?? item.id}`}
                subtitle={[item.huntingDistrictName, item.date ?? item.startDate]
                  .filter(Boolean)
                  .join(' · ')}
                right={() => (
                  <Text style={styles.status}>
                    <StatusChip status={item.status} />
                  </Text>
                )}
              />
            </Card>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 8 },
  card: { borderRadius: 14 },
  status: { marginRight: 12 },
});
