import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, Card, Divider, List, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { useUnits } from '@/units/UnitProvider';
import { config } from '@/config';

/** Decodes the `name`/`email` claims from the id_token for display (no verify). */
function decodeIdToken(idToken?: string): Record<string, unknown> | null {
  if (!idToken) return null;
  try {
    const [, payload] = idToken.split('.');
    const json =
      typeof atob === 'function'
        ? atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { tokens, signOut, hasSavedCredentials, disableAutoLogin } = useAuth();
  const { units, activeUnit, user } = useUnits();

  const claims = decodeIdToken(tokens?.idToken);
  // Prefer the real name from /userinfo; fall back to id_token claims.
  const name =
    user?.fullName ??
    (claims?.name as string) ??
    (claims?.preferred_username as string) ??
    'Myśliwy';
  const email = user?.email ?? (claims?.email as string) ?? '';
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const onSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Avatar.Text label={initials} size={72} />
          <Text variant="titleLarge" style={styles.name}>
            {name}
          </Text>
          {email ? (
            <Text variant="bodyMedium" style={styles.muted}>
              {email}
            </Text>
          ) : null}
        </View>

        <Card
          mode="contained"
          style={[
            styles.card,
            {
              backgroundColor: hasSavedCredentials
                ? theme.colors.primaryContainer
                : theme.colors.surfaceVariant,
            },
          ]}
        >
          <List.Item
            title={
              hasSavedCredentials
                ? 'Automatyczne logowanie: włączone'
                : 'Automatyczne logowanie: wyłączone'
            }
            description={
              hasSavedCredentials
                ? 'Pozostajesz zalogowany — sesja odnawia się automatycznie w tle. Dane są dostępne offline (z zapisaną datą aktualizacji).'
                : 'Po wygaśnięciu sesji konieczne będzie ponowne logowanie.'
            }
            left={(p) => (
              <List.Icon
                {...p}
                icon={hasSavedCredentials ? 'shield-check' : 'shield-off-outline'}
                color={hasSavedCredentials ? theme.colors.primary : undefined}
              />
            )}
          />
          {hasSavedCredentials ? (
            <Card.Actions>
              <Button onPress={disableAutoLogin} textColor={theme.colors.error}>
                Wyłącz i zapomnij dane
              </Button>
            </Card.Actions>
          ) : null}
        </Card>

        <Card mode="outlined" style={styles.card}>
          <List.Subheader>Koła łowieckie</List.Subheader>
          {units.map((u) => (
            <List.Item
              key={u.id}
              title={u.name}
              description={u.type ?? u.number}
              left={(p) => <List.Icon {...p} icon="pine-tree" />}
              right={(p) =>
                u.id === activeUnit?.id ? (
                  <List.Icon {...p} icon="check" color={theme.colors.primary} />
                ) : null
              }
            />
          ))}
          {units.length === 0 ? (
            <List.Item title="Brak przypisanych kół" />
          ) : null}
        </Card>

        <Card mode="outlined" style={styles.card}>
          <List.Item
            title="Więcej modułów"
            description="Plany, upoważnienia, finanse, szkody…"
            left={(p) => <List.Icon {...p} icon="view-grid-outline" />}
            right={(p) => <List.Icon {...p} icon="chevron-right" />}
            onPress={() => router.push('/(app)/(tabs)/(menu)' as never)}
          />
        </Card>

        <Card mode="outlined" style={styles.card}>
          <List.Subheader>Środowisko</List.Subheader>
          <List.Item title="API" description={config.apiBaseUrl} />
          <Divider />
          <List.Item title="Auth" description={config.authIssuer} />
          <Divider />
          <List.Item title="GIS" description={config.geoBaseUrl} />
        </Card>

        <Button
          mode="contained-tonal"
          icon="logout"
          onPress={onSignOut}
          style={styles.logout}
        >
          Wyloguj się
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  header: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  name: { fontWeight: '700' },
  muted: { opacity: 0.6 },
  card: { borderRadius: 14 },
  logout: { marginTop: 8, borderRadius: 12 },
});
