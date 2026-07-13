import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Button, HelperText, Surface, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { brand } from '@/theme/theme';

const IS_WEB = Platform.OS === 'web';

export default function Login() {
  const { ready, isAuthenticated, signIn, signInDemo, beginWebLogin, completeWebLogin } =
    useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (ready && isAuthenticated) return <Redirect href="/(app)/(tabs)/map" />;

  const go = () => router.replace('/(app)/(tabs)/map');

  const onNativeSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
      go();
    } finally {
      setBusy(false);
    }
  };

  const onWebStart = async () => {
    setError(null);
    setBusy(true);
    try {
      const url = await beginWebLogin();
      // Open PZŁ login in a new tab; the user pastes the resulting URL back.
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      else Linking.openURL(url);
      setAwaitingPaste(true);
    } finally {
      setBusy(false);
    }
  };

  const onWebComplete = async () => {
    setError(null);
    setBusy(true);
    try {
      await completeWebLogin(pasted);
      go();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zalogować');
    } finally {
      setBusy(false);
    }
  };

  const onDemo = async () => {
    setBusy(true);
    try {
      await signInDemo();
      go();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>PZŁ</Text>
        </View>
        <Text variant="headlineSmall" style={styles.title}>
          Koła Łowieckie
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          System zarządzania kołem łowieckim
        </Text>
      </View>

      <Surface style={styles.card} elevation={2}>
        {!awaitingPaste ? (
          <>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Zaloguj się
            </Text>
            <Text variant="bodySmall" style={styles.cardHint}>
              Logowanie przez konto Polskiego Związku Łowieckiego.
            </Text>
            <Button
              mode="contained"
              onPress={IS_WEB ? onWebStart : onNativeSignIn}
              loading={busy}
              disabled={busy || !ready}
              style={styles.button}
              icon="login"
            >
              Zaloguj przez PZŁ
            </Button>
          </>
        ) : (
          <>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Dokończ logowanie
            </Text>
            <Text variant="bodySmall" style={styles.cardHint}>
              1. Zaloguj się w otwartej karcie PZŁ.{'\n'}
              2. Po zalogowaniu przeglądarka przejdzie na adres zaczynający się od{' '}
              <Text style={styles.mono}>systemkl2.pzlow.pl/auth?code=…</Text>{'\n'}
              3. Skopiuj cały ten adres z paska przeglądarki i wklej go poniżej.
            </Text>
            <TextInput
              mode="outlined"
              label="Wklej adres (lub sam kod)"
              value={pasted}
              onChangeText={setPasted}
              autoCapitalize="none"
              multiline
              style={styles.input}
            />
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
            <Button
              mode="contained"
              onPress={onWebComplete}
              loading={busy}
              disabled={busy || !pasted.trim()}
              style={styles.button}
              icon="check"
            >
              Zakończ logowanie
            </Button>
            <Button
              mode="text"
              onPress={() => {
                setAwaitingPaste(false);
                setPasted('');
                setError(null);
              }}
              disabled={busy}
            >
              Anuluj
            </Button>
          </>
        )}

        <View style={styles.divider} />
        <Button
          mode="outlined"
          onPress={onDemo}
          disabled={busy}
          style={styles.demoButton}
          icon="flask-outline"
        >
          Wejdź w trybie demo
        </Button>
        <Text variant="bodySmall" style={styles.demoHint}>
          Tryb demo działa bez konta — z przykładowymi danymi.
        </Text>
      </Surface>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.greenDark, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: brand.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: { color: brand.greenDark, fontSize: 30, fontWeight: '800' },
  title: { color: '#fff', fontWeight: '700' },
  subtitle: { color: '#dfeeda' },
  card: { margin: 20, padding: 24, borderRadius: 20, gap: 10 },
  cardTitle: { fontWeight: '700' },
  cardHint: { opacity: 0.7, lineHeight: 18 },
  mono: { fontFamily: 'monospace' as never },
  input: { maxHeight: 120 },
  button: { marginTop: 4, borderRadius: 12 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 6 },
  demoButton: { borderRadius: 12 },
  demoHint: { opacity: 0.6, textAlign: 'center' },
});
