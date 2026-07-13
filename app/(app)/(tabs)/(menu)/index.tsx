import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Badge,
  Button,
  Card,
  Menu,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { MODULES, type ModuleDef } from '@/features/modules';
import { useUnits } from '@/units/UnitProvider';

export default function MenuScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { units, activeUnit, setActiveUnitId } = useUnits();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <View style={styles.root}>
      <Surface style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <Text variant="labelSmall" style={styles.headerLabel}>
          AKTYWNE KOŁO
        </Text>
        <Menu
          visible={switcherOpen}
          onDismiss={() => setSwitcherOpen(false)}
          anchor={
            <Button
              mode="text"
              textColor="#fff"
              icon="chevron-down"
              contentStyle={{ flexDirection: 'row-reverse' }}
              onPress={() => setSwitcherOpen(true)}
            >
              {activeUnit?.name ?? 'Wybierz koło'}
            </Button>
          }
        >
          {units.map((u) => (
            <Menu.Item
              key={u.id}
              title={u.name}
              onPress={() => {
                setActiveUnitId(u.id);
                setSwitcherOpen(false);
              }}
            />
          ))}
          {units.length === 0 ? (
            <Menu.Item title="Brak dostępnych kół" disabled />
          ) : null}
        </Menu>
      </Surface>

      <FlatList
        data={MODULES}
        keyExtractor={(m) => m.key}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <ModuleCard
            module={item}
            onPress={() => router.push(item.route as never)}
          />
        )}
      />
    </View>
  );
}

function ModuleCard({
  module,
  onPress,
}: {
  module: ModuleDef;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.card} onPress={onPress} mode="elevated">
      <Card.Content style={styles.cardContent}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.primaryContainer },
          ]}
        >
          <MaterialCommunityIcons
            name={module.icon as never}
            size={26}
            color={theme.colors.primary}
          />
          {!module.implemented ? (
            <Badge style={styles.soon} size={16}>
              …
            </Badge>
          ) : null}
        </View>
        <Text variant="titleSmall" numberOfLines={2} style={styles.cardTitle}>
          {module.title}
        </Text>
        <Text variant="bodySmall" numberOfLines={2} style={styles.cardSub}>
          {module.subtitle}
        </Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 10 },
  headerLabel: { color: '#dfeeda', letterSpacing: 1 },
  grid: { padding: 12 },
  row: { gap: 12 },
  card: { flex: 1, marginBottom: 12, borderRadius: 16 },
  cardContent: { alignItems: 'flex-start', gap: 6, paddingVertical: 14 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: { position: 'absolute', top: -4, right: -4 },
  cardTitle: { fontWeight: '700' },
  cardSub: { opacity: 0.6 },
});
