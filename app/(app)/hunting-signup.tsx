import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  HelperText,
  Menu,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useIsOnline } from '@/offline/connectivity';
import { useSignUpHunt } from '@/features/huntingBook/api';
import {
  useAnimalTypeOptions,
  useHunterOptions,
  useHuntingDistrictOptions,
  useStandOptions,
  type Option,
} from '@/features/huntingBook/lookups';
import { useUnits } from '@/units/UnitProvider';

function Dropdown({
  label,
  options,
  value,
  onChange,
  loading,
}: {
  label: string;
  options: Option[];
  value?: Option;
  onChange: (o: Option) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        <TextInput
          label={label}
          mode="outlined"
          editable={false}
          value={value?.label ?? ''}
          right={<TextInput.Icon icon="menu-down" onPress={() => setOpen(true)} />}
          onPressIn={() => setOpen(true)}
          placeholder={loading ? 'Wczytywanie…' : 'Wybierz…'}
        />
      }
    >
      <ScrollView style={styles.menuScroll}>
        {options.map((o) => (
          <Menu.Item
            key={o.id}
            title={o.label}
            onPress={() => {
              onChange(o);
              setOpen(false);
            }}
          />
        ))}
        {options.length === 0 ? (
          <Menu.Item title={loading ? 'Wczytywanie…' : 'Brak danych'} disabled />
        ) : null}
      </ScrollView>
    </Menu>
  );
}

export default function HuntingSignup() {
  const theme = useTheme();
  const router = useRouter();
  const online = useIsOnline();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'self' | 'other'>(
    modeParam === 'other' ? 'other' : 'self',
  );

  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';
  const signUp = useSignUpHunt(unitId);

  const hunters = useHunterOptions(unitId);
  const districts = useHuntingDistrictOptions(unitId);
  const animals = useAnimalTypeOptions();
  const stands = useStandOptions(unitId);

  const [hunter, setHunter] = useState<Option>();
  const [district, setDistrict] = useState<Option>();
  const [animal, setAnimal] = useState<Option>();
  const [stand, setStand] = useState<Option>();
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => !!district && (mode === 'self' || !!hunter),
    [district, hunter, mode],
  );

  const submit = async () => {
    setError(null);
    if (!unitId || !district) return;
    try {
      await signUp.mutateAsync({
        unitId,
        hunterId: mode === 'other' ? hunter?.id : undefined,
        hunterName: mode === 'other' ? hunter?.label : 'Ja',
        huntingDistrictId: district.id,
        huntingDistrictName: district.label,
        standId: stand?.id,
        standNumber: stand?.label,
        animalTypeId: animal?.id,
        animalTypeName: animal?.label,
        startTimestamp: new Date().toISOString(),
      });
      // Success (or queued offline) — either way the entry is in the local list.
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Zapis na polowanie',
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.primary },
          headerTintColor: '#fff',
          presentation: 'modal',
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as 'self' | 'other')}
          buttons={[
            { value: 'self', label: 'Ja', icon: 'account' },
            { value: 'other', label: 'Inny myśliwy', icon: 'account-group' },
          ]}
        />

        {mode === 'other' ? (
          <Dropdown
            label="Myśliwy"
            options={hunters.data ?? []}
            value={hunter}
            onChange={setHunter}
            loading={hunters.isLoading}
          />
        ) : null}

        <Dropdown
          label="Obwód łowiecki *"
          options={districts.data ?? []}
          value={district}
          onChange={setDistrict}
          loading={districts.isLoading}
        />
        <Dropdown
          label="Ambona / stanowisko"
          options={stands.data ?? []}
          value={stand}
          onChange={setStand}
          loading={stands.isLoading}
        />
        <Dropdown
          label="Gatunek zwierzyny"
          options={animals.data ?? []}
          value={animal}
          onChange={setAnimal}
          loading={animals.isLoading}
        />

        <Text variant="bodySmall" style={styles.startNote}>
          Rozpoczęcie: teraz ({new Date().toLocaleString('pl-PL')})
        </Text>

        {!online ? (
          <HelperText type="info" visible>
            Jesteś offline — zapis zostanie wysłany automatycznie po odzyskaniu
            połączenia.
          </HelperText>
        ) : null}
        {error ? (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        ) : null}

        <Button
          mode="contained"
          icon="check"
          loading={signUp.isPending}
          disabled={!canSubmit || signUp.isPending}
          onPress={submit}
          style={styles.submit}
        >
          {online ? 'Rozpocznij polowanie' : 'Zapisz offline'}
        </Button>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  menuScroll: { maxHeight: 320 },
  startNote: { opacity: 0.7 },
  submit: { marginTop: 8, borderRadius: 12 },
});
