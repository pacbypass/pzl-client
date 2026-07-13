import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Card, FAB, Text, useTheme } from 'react-native-paper';
import { EmptyState, ErrorState, LoadingScreen, StatusChip } from '@/components/ui';
import { useHuntingDamages } from '@/features/huntingDamages/api';
import { useUnits } from '@/units/UnitProvider';

export default function HuntingDamagesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { activeUnitId } = useUnits();
  const query = useHuntingDamages(activeUnitId ?? '');

  if (!activeUnitId) return <EmptyState title="Wybierz koło łowieckie" />;

  const data = query.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Szkody łowieckie' }} />
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {query.isLoading ? (
          <LoadingScreen label="Wczytywanie szkód…" />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : data.length === 0 ? (
          <EmptyState
            icon="sprout"
            title="Brak zgłoszonych szkód"
            subtitle="Dodaj pierwsze zgłoszenie szkody łowieckiej."
          />
        ) : (
          <FlatList
            contentContainerStyle={styles.list}
            data={data}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Card style={styles.card} mode="contained">
                <Card.Title
                  title={`${item.cropType ?? 'Szkoda'} · ${item.animalType ?? ''}`}
                  subtitle={[item.location, item.reportDate]
                    .filter(Boolean)
                    .join(' · ')}
                  right={() => (
                    <View style={styles.right}>
                      <StatusChip status={item.status} />
                    </View>
                  )}
                />
                {(item.damagedAreaHa || item.estimatedValue) && (
                  <Card.Content>
                    <Text variant="bodySmall">
                      {item.damagedAreaHa
                        ? `Powierzchnia: ${item.damagedAreaHa} ha  `
                        : ''}
                      {item.estimatedValue
                        ? `Szacowana wartość: ${item.estimatedValue} zł`
                        : ''}
                    </Text>
                  </Card.Content>
                )}
              </Card>
            )}
          />
        )}

        <FAB
          icon="plus"
          label="Zgłoś szkodę"
          style={styles.fab}
          onPress={() =>
            router.push(
              '/(app)/(tabs)/(menu)/(modules)/hunting-damage-new' as never,
            )
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 12, gap: 8 },
  card: { borderRadius: 14 },
  right: { marginRight: 12, justifyContent: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
