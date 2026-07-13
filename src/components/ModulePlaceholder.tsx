import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Card, Chip, Text, useTheme } from 'react-native-paper';
import { useUnits } from '@/units/UnitProvider';

/**
 * Shared scaffold for modules whose UI isn't built out yet. Shows the module's
 * purpose and the concrete backend endpoints recovered for it, so the screen is
 * a working stub over the real API rather than an empty page.
 */
export function ModulePlaceholder({
  title,
  icon,
  description,
  endpoints,
}: {
  title: string;
  icon: string;
  description: string;
  endpoints: string[];
}) {
  const theme = useTheme();
  const { activeUnit } = useUnits();

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.primaryContainer },
          ]}
        >
          <MaterialCommunityIcons
            name={icon as never}
            size={40}
            color={theme.colors.primary}
          />
        </View>
        <Text variant="headlineSmall" style={styles.title}>
          {title}
        </Text>
        <Text variant="bodyMedium" style={styles.desc}>
          {description}
        </Text>
        <Chip icon="hammer-wrench" style={styles.chip}>
          Moduł w przygotowaniu
        </Chip>

        <Card style={styles.card} mode="outlined">
          <Card.Title title="Endpointy API (z reverse engineeringu)" />
          <Card.Content>
            {activeUnit ? (
              <Text variant="labelSmall" style={styles.unit}>
                unit-id = {activeUnit.id}
              </Text>
            ) : null}
            {endpoints.map((e) => (
              <Text key={e} variant="bodySmall" style={styles.endpoint}>
                {e}
              </Text>
            ))}
          </Card.Content>
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', padding: 24, gap: 8 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  title: { fontWeight: '700', marginTop: 12, textAlign: 'center' },
  desc: { textAlign: 'center', opacity: 0.7 },
  chip: { marginTop: 8 },
  card: { width: '100%', marginTop: 24 },
  unit: { opacity: 0.6, marginBottom: 8 },
  endpoint: { fontFamily: 'monospace' as never, marginVertical: 2 },
});
