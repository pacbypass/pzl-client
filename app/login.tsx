import React, { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  Button,
  Checkbox,
  HelperText,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { brand } from '@/theme/theme';

const IS_WEB = Platform.OS === 'web';

export default function Login() {
  const {
    ready,
    isAuthenticated,
    signInWithPassword,
    signInDemo,
    beginWebLogin,
    completeWebLogin,
  } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Native username/password state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);

  // Web code-paste state
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const [pasted, setPasted] = useState('');

  if (ready && isAuthenticated) return <Redirect href="/(app)/(tabs)/map" />;
  const go = () => router.replace('/(app)/(tabs)/map');

  const onPasswordLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(username.trim(), password, remember);
      go();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zalogować');
    } finally {
      setBusy(false);
    }
  };

  const onWebStart = async () => {
    setError(null);
    setBusy(true);
    try {
      const url = await beginWebLogin();
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
        {!IS_WEB ? (
          // ---- Native: username / password ----
          <>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Zaloguj się
            </Text>
            <TextInput
              mode="outlined"
              label="Numer PZŁ / login"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              left={<TextInput.Icon icon="account" />}
            />
            <TextInput
              mode="outlined"
              label="Hasło"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              autoCapitalize="none"
              left={<TextInput.Icon icon="lock" />}
              right={
                <TextInput.Icon
                  icon={showPass ? 'eye-off' : 'eye'}
                  onPress={() => setShowPass((s) => !s)}
                />
              }
            />
            <Checkbox.Item
              label="Nie wylogowuj mnie (zapamiętaj dane)"
              status={remember ? 'checked' : 'unchecked'}
              onPress={() => setRemember((r) => !r)}
              position="leading"
              style={styles.checkbox}
              labelStyle={styles.checkboxLabel}
            />
            {remember ? (
              <HelperText type="info" visible style={styles.hint}>
                Zostaniesz zalogowany na stałe — aplikacja odnawia sesję w tle,
                także po utracie zasięgu. Dane logowania są szyfrowane na urządzeniu.
              </HelperText>
            ) : null}
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
            <Button
              mode="contained"
              icon="login"
              loading={busy}
              disabled={busy || !username.trim() || !password}
              onPress={onPasswordLogin}
              style={styles.button}
            >
              Zaloguj się
            </Button>
          </>
        ) : !awaitingPaste ? (
          // ---- Web step 1 ----
          <>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Zaloguj się
            </Text>
            <Text variant="bodySmall" style={styles.cardHint}>
              Logowanie przez konto Polskiego Związku Łowieckiego.
            </Text>
            <Button
              mode="contained"
              onPress={onWebStart}
              loading={busy}
              disabled={busy || !ready}
              style={styles.button}
              icon="login"
            >
              Zaloguj przez PZŁ
            </Button>
          </>
        ) : (
          // ---- Web step 2 (paste code) ----
          <>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Dokończ logowanie
            </Text>
            <Text variant="bodySmall" style={styles.cardHint}>
              Po zalogowaniu w otwartej karcie skopiuj adres zaczynający się od{' '}
              <Text style={styles.mono}>systemkl2.pzlow.pl/auth?code=…</Text> i
              wklej go poniżej.
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
            <Button mode="text" onPress={() => setAwaitingPaste(false)} disabled={busy}>
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
  card: { margin: 20, padding: 22, borderRadius: 20, gap: 10 },
  cardTitle: { fontWeight: '700' },
  cardHint: { opacity: 0.7, lineHeight: 18 },
  mono: { fontFamily: 'monospace' as never },
  input: { maxHeight: 120 },
  checkbox: { paddingHorizontal: 0, marginTop: 2 },
  checkboxLabel: { textAlign: 'left', fontSize: 14 },
  hint: { paddingHorizontal: 0 },
  button: { marginTop: 6, borderRadius: 12 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 8 },
  demoButton: { borderRadius: 12 },
});
