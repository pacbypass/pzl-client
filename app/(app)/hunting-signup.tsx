import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Checkbox,
  Divider,
  HelperText,
  Menu,
  SegmentedButtons,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { useIsOnline } from '@/offline/connectivity';
import { useAuth } from '@/auth/AuthProvider';
import { personIdFromToken } from '@/auth/jwt';
import {
  isCurrentPermit,
  useHunterPermits,
  useMyAuthorizations,
  useRewirOptions,
  useSignUpHunt,
} from '@/features/huntingBook/api';
import {
  useHunterOptions,
  useHuntingDistrictOptions,
  useHuntingYears,
  type Option,
} from '@/features/huntingBook/lookups';
import { useUnits } from '@/units/UnitProvider';
import { DateTimeField, atSecond59 } from '@/components/DateTimeField';

const HOUR = 3600 * 1000;

function Dropdown({
  label,
  options,
  value,
  onChange,
  loading,
  emptyText = 'Brak danych',
}: {
  label: string;
  options: Option[];
  value?: Option;
  onChange: (o: Option) => void;
  loading?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={
        // Full-width tap target (not just the icon) — see DateTimeField.
        <TouchableRipple onPress={() => setOpen(true)}>
          <View pointerEvents="none">
            <TextInput
              label={label}
              mode="outlined"
              editable={false}
              value={value?.label ?? ''}
              right={<TextInput.Icon icon="menu-down" />}
              placeholder={loading ? 'Wczytywanie…' : 'Wybierz…'}
            />
          </View>
        </TouchableRipple>
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
          <Menu.Item title={loading ? 'Wczytywanie…' : emptyText} disabled />
        ) : null}
      </ScrollView>
    </Menu>
  );
}

export default function HuntingSignup() {
  const theme = useTheme();
  const router = useRouter();
  // The form ends with "Rozpocznij polowanie"; without this the button sits
  // right on the system navigation bar at the bottom of the screen.
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'self' | 'other'>(
    modeParam === 'other' ? 'other' : 'self',
  );

  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';
  const signUp = useSignUpHunt(unitId);
  const { tokens } = useAuth();
  // My own person id (for self sign-up's hunterId) from the access token.
  const myPersonId = useMemo(
    () => personIdFromToken(tokens?.accessToken),
    [tokens?.accessToken],
  );

  const years = useHuntingYears();
  const year = years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value;

  const hunters = useHunterOptions(unitId);
  const districts = useHuntingDistrictOptions(unitId);

  const [hunter, setHunter] = useState<Option>();
  const [district, setDistrict] = useState<Option>();
  const [permitIds, setPermitIds] = useState<number[]>([]);
  const [rewir, setRewir] = useState<Option>();
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Permit source depends on mode: my own permits (self) vs. the selected
  // hunter's permits (booking another hunter).
  const myPermits = useMyAuthorizations(unitId, mode === 'self' ? year : undefined);
  const otherPermits = useHunterPermits(unitId, mode === 'other' ? hunter?.id : undefined);
  const permitsQuery = mode === 'other' ? otherPermits : myPermits;

  const now = useMemo(() => atSecond59(new Date()), []);
  const [start, setStart] = useState<Date>(now);
  const [end, setEnd] = useState<Date>(atSecond59(new Date(now.getTime() + 3 * HOUR)));

  const rewirs = useRewirOptions(unitId, district?.id);
  const rewirOptions = useMemo<Option[]>(
    () => (rewirs.data ?? []).map((r) => ({ id: r.id, label: r.name })),
    [rewirs.data],
  );

  // Permits for the chosen obwód — only the ones still valid today. The season
  // list (`/authorizations/me`) also carries permits that were handed back or
  // have run out; offering those is what made three appear per obwód where the
  // vendor app shows two.
  const permitsForDistrict = useMemo(
    () =>
      (permitsQuery.data ?? []).filter(
        (a) =>
          district &&
          String(a.huntingDistrictId) === district.id &&
          isCurrentPermit(a),
      ),
    [permitsQuery.data, district],
  );

  // Reset the permit selection when the obwód, the booked hunter, or who is
  // being signed up (me / another hunter) changes: the permits on offer are
  // someone else's then.
  useEffect(() => {
    setPermitIds([]);
  }, [district?.id, hunter?.id, mode]);

  // Only permits actually on offer can be sent — never one left ticked from
  // a list that is no longer shown.
  const selectedPermitIds = useMemo(
    () => permitIds.filter((id) => permitsForDistrict.some((p) => p.id === id)),
    [permitIds, permitsForDistrict],
  );

  // Reset rewir when the obwód changes.
  useEffect(() => {
    setRewir(undefined);
  }, [district?.id]);

  const togglePermit = (id: number) =>
    setPermitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  // Validation. A start that has slipped into the past is NOT an error — it is
  // clamped to max(now, start) at send time (see clampStartToNow), so submitting
  // stays allowed and the hunt just starts "now". The end is validated against
  // that effective start.
  const effectiveStart = Math.max(start.getTime(), atSecond59(new Date()).getTime());
  const endAfterStart = end.getTime() > effectiveStart;
  const endWithin24h = end.getTime() <= effectiveStart + 24 * HOUR;
  const dateError = !endAfterStart
    ? 'Zakończenie musi być po rozpoczęciu.'
    : !endWithin24h
      ? 'Polowanie nie może trwać dłużej niż 24 godziny.'
      : null;

  // hunterId (person id): self = token person_id, other = selected hunter.
  const hunterId = mode === 'other' ? Number(hunter?.id) : myPersonId;

  const canSubmit =
    !!district &&
    selectedPermitIds.length > 0 &&
    !!rewir &&
    !!hunterId &&
    !dateError;

  const submit = async () => {
    setError(null);
    if (!unitId || !district || !rewir || !hunterId || !canSubmit) return;
    try {
      await signUp.mutateAsync({
        unitId,
        anotherHunter: mode === 'other',
        hunterId,
        hunterName: mode === 'other' ? hunter?.label : 'Ja',
        huntingDistrictId: district.id,
        huntingDistrictName: district.label,
        permitIds: selectedPermitIds,
        permitLabel: permitsForDistrict.find((p) => p.id === selectedPermitIds[0])?.number,
        huntingGroundIds: [Number(rewir.id)],
        huntingPlaceName: rewir.label,
        startTimestamp: start.toISOString(),
        endTimestamp: end.toISOString(),
        notes: notes.trim() || undefined,
        confirmOtherHuntersConsent: consent,
      });
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
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 48 },
        ]}
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
            label="Myśliwy *"
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

        {/* Upoważnienia — multi-choice, only those for the chosen obwód. */}
        <View>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            Upoważnienia *
          </Text>
          {mode === 'other' && !hunter ? (
            <HelperText type="info" visible>
              Najpierw wybierz myśliwego.
            </HelperText>
          ) : !district ? (
            <HelperText type="info" visible>
              Najpierw wybierz obwód.
            </HelperText>
          ) : permitsQuery.isLoading ? (
            <HelperText type="info" visible>
              Wczytywanie upoważnień…
            </HelperText>
          ) : permitsForDistrict.length === 0 ? (
            <HelperText type="error" visible>
              Brak aktywnych upoważnień dla obwodu {district.label}.
            </HelperText>
          ) : (
            <View style={styles.permits}>
              {permitsForDistrict.map((p) => (
                <Checkbox.Item
                  key={p.id}
                  label={p.number.split(';')[0].trim()}
                  status={permitIds.includes(p.id) ? 'checked' : 'unchecked'}
                  onPress={() => togglePermit(p.id)}
                  position="leading"
                  style={styles.permitItem}
                />
              ))}
            </View>
          )}
        </View>

        <Divider />

        <DateTimeField
          label="Rozpoczęcie *"
          value={start}
          minimumDate={now}
          onChange={setStart}
        />
        <DateTimeField
          label="Zakończenie *"
          value={end}
          minimumDate={start}
          onChange={setEnd}
        />
        {dateError ? (
          <HelperText type="error" visible>
            {dateError}
          </HelperText>
        ) : null}

        <Divider />

        <Dropdown
          label="Rewir *"
          options={rewirOptions}
          value={rewir}
          onChange={setRewir}
          loading={rewirs.isLoading}
          emptyText={district ? 'Brak rewirów' : 'Najpierw wybierz obwód'}
        />

        <TextInput
          label="Uwagi"
          mode="outlined"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        {/* Required by the server only when the chosen rewir is already taken
            ("Zgoda myśliwych jest wymagana gdy chcesz skorzystać z zajętego
            rewiru!"). Must be the user's own tick — never auto-asserted. */}
        <View>
          <Text variant="labelLarge" style={styles.sectionLabel}>
            Zgoda myśliwych
          </Text>
          <Checkbox.Item
            label="Potwierdzam uzyskanie zgody innych myśliwych na wspólne korzystanie z wskazanego rewiru łowieckiego."
            status={consent ? 'checked' : 'unchecked'}
            onPress={() => setConsent((c) => !c)}
            position="leading"
            labelVariant="bodySmall"
            style={styles.permitItem}
          />
          <HelperText type="info" visible>
            Wymagane tylko, gdy wybrany rewir jest już zajęty.
          </HelperText>
        </View>

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
  sectionLabel: { marginBottom: 2 },
  permits: { borderRadius: 8, overflow: 'hidden' },
  permitItem: { paddingVertical: 0 },
  submit: { marginTop: 8, borderRadius: 12 },
});
