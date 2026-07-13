import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Button, HelperText, Snackbar, TextInput, useTheme } from 'react-native-paper';
import {
  useCreateHuntingDamage,
  type CreateHuntingDamageInput,
} from '@/features/huntingDamages/api';
import { useUnits } from '@/units/UnitProvider';

export default function NewHuntingDamage() {
  const theme = useTheme();
  const router = useRouter();
  const { activeUnitId } = useUnits();
  const mutation = useCreateHuntingDamage(activeUnitId ?? '');

  const [form, setForm] = useState<CreateHuntingDamageInput>({});
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof CreateHuntingDamageInput) => (v: string) =>
    setForm((f) => ({
      ...f,
      [k]: k === 'damagedAreaHa' ? Number(v.replace(',', '.')) || undefined : v,
    }));

  const submit = async () => {
    setError(null);
    try {
      await mutation.mutateAsync(form);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Nowa szkoda' }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
      >
        <TextInput
          label="Rodzaj uprawy"
          mode="outlined"
          value={form.cropType ?? ''}
          onChangeText={set('cropType')}
        />
        <TextInput
          label="Gatunek zwierzyny"
          mode="outlined"
          value={form.animalType ?? ''}
          onChangeText={set('animalType')}
        />
        <TextInput
          label="Lokalizacja / obwód"
          mode="outlined"
          value={form.location ?? ''}
          onChangeText={set('location')}
        />
        <TextInput
          label="Powierzchnia szkody (ha)"
          mode="outlined"
          keyboardType="decimal-pad"
          value={form.damagedAreaHa?.toString() ?? ''}
          onChangeText={set('damagedAreaHa')}
        />
        <TextInput
          label="Właściciel / poszkodowany"
          mode="outlined"
          value={form.ownerName ?? ''}
          onChangeText={set('ownerName')}
        />
        <TextInput
          label="Opis"
          mode="outlined"
          multiline
          numberOfLines={4}
          value={form.description ?? ''}
          onChangeText={set('description')}
        />
        <HelperText type="info" visible>
          POST /units/{activeUnitId}/hunting-damages
        </HelperText>
        <Button
          mode="contained"
          icon="content-save"
          loading={mutation.isPending}
          disabled={mutation.isPending || !activeUnitId}
          onPress={submit}
          style={styles.submit}
        >
          Zapisz zgłoszenie
        </Button>
      </ScrollView>
      <Snackbar visible={!!error} onDismiss={() => setError(null)}>
        {error ?? ''}
      </Snackbar>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  submit: { marginTop: 8, borderRadius: 12 },
});
