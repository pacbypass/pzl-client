import React, { useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  HelperText,
  IconButton,
  List,
  Menu,
  Portal,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { ErrorState } from '@/components/ui';
import { DateTimeField } from '@/components/DateTimeField';
import {
  huntStatus,
  type BookEntry,
  type HuntStatus,
} from '@/features/huntingBook/book';
import {
  newHarvestGuard,
  useAddHarvest,
  useDeleteHunt,
  useHuntAnimals,
  useHuntDetail,
  usePermitAnimals,
  useUpdateHunt,
  type HuntAnimal,
  type HuntDetail,
  type PermitAnimalSlot,
} from '@/features/huntingBook/manage';
import { useUnits } from '@/units/UnitProvider';

/** Status → colour + label for the chip, top bar and cards. */
const STATUS_META: Record<
  HuntStatus,
  { color: string; label: string; icon: string }
> = {
  active: { color: '#2e7d32', label: 'Na polowaniu', icon: 'target' },
  overdue: { color: '#c62828', label: 'Po czasie', icon: 'clock-alert-outline' },
  closed: { color: '#616161', label: 'Zakończone', icon: 'check' },
  crossed: { color: '#616161', label: 'Wykreślone', icon: 'close-circle-outline' },
};

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function animalLabel(a: HuntAnimal): string {
  const name = a.name ?? 'Zwierzyna';
  const bits: string[] = [];
  if (a.quantity != null && a.quantity > 1) bits.push(`${a.quantity} szt.`);
  if (a.isMale != null) bits.push(a.isMale ? 'samiec' : 'samica');
  if (a.age != null && a.age !== '') bits.push(`wiek ${a.age}`);
  if (a.weight != null) bits.push(`${a.weight} kg`);
  return bits.length ? `${name} · ${bits.join(', ')}` : name;
}

export default function HuntDetailScreen() {
  const theme = useTheme();
  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';
  const params = useLocalSearchParams<{ entry?: string }>();

  const seed = useMemo<BookEntry | null>(() => {
    try {
      return params.entry ? (JSON.parse(params.entry) as BookEntry) : null;
    } catch {
      return null;
    }
  }, [params.entry]);

  const districtId = seed?.huntingDistrictId ?? undefined;
  const detailQuery = useHuntDetail(
    unitId,
    districtId ?? undefined,
    seed?.id,
    seed as unknown as HuntDetail | undefined,
  );
  // The real recorded-animals list (the detail object's own `animals` is just a
  // name string). Refetched on "Dodaj pozyskanie" success + the refresh button.
  const animalsQuery = useHuntAnimals(unitId, districtId, seed?.id);

  const [addOpen, setAddOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCross, setConfirmCross] = useState(false);

  if (!seed) return <ErrorState error={new Error('Brak danych wpisu')} />;

  const d = (detailQuery.data ?? (seed as unknown as HuntDetail)) as HuntDetail;
  // Single source of truth for status/colour (see huntStatus): crossed / closed
  // (someone wrote out) / overdue (past end, not closed) / active.
  const status = huntStatus(d as unknown as BookEntry);
  const meta = STATUS_META[status];
  const open = status === 'active' || status === 'overdue';
  const crossed = status === 'crossed';
  const canEdit = d.canEdit ?? open;
  const canManage = open && canEdit;
  const canAddAfterEnd = !open && !crossed && (d.canChangeDataAfterEnd ?? false);
  // Cross-out ("wykreślić się"): shown while the hunt is open and the server
  // permits it (canDeleteHunting), but only ENABLED before the hunt starts —
  // once we're past the start it greys out (you can no longer cross yourself out).
  const startMs = d.startDate ? Date.parse(d.startDate) : NaN;
  const beforeStart = !Number.isNaN(startMs) && startMs > Date.now();
  const showCrossOut = open && (d.canDeleteHunting ?? false);

  // Recorded animals come from the sub-resource query, split by isWounded.
  const allAnimals = animalsQuery.data ?? [];
  const animals = allAnimals.filter((a) => !a.isWounded);
  const wounded = allAnimals.filter((a) => a.isWounded);
  const permits = d.permitNumbers ?? [];
  const grounds = d.huntingGrounds ?? [];
  const refreshing = detailQuery.isFetching || animalsQuery.isFetching;
  const refresh = () => {
    detailQuery.refetch();
    animalsQuery.refetch();
  };

  const rows: [string, string | undefined | null][] = [
    ['Myśliwy', d.leadingPersonFullname],
    ['Rewir łowiecki', d.huntingPlace],
    ['Rozpoczęcie', fmt(d.startDate)],
    // Always show the end date (planned/actual) so it's visible while editing.
    ['Zakończenie', fmt(d.endDate)],
    ['Numer upoważnienia', d.permitNumber],
    // checkin = who signed in (zapisał), checkout = who signed out (wypisał).
    ['Zapisał', d.checkinPersonFullname],
    ['Wypisał', d.checkoutPersonFullname],
    ['Oddane strzały', String(d.shotsFired ?? 0)],
    ['Uwagi od myśliwego', d.notes],
    ['Uwagi od skarbnika', d.treasurerNotes],
  ];

  return (
    <>
      <Stack.Screen
        options={{
          // Entry number (numer wpisu) — from the list row, which carries the
          // real number; the detail endpoint's `number` is not it.
          title: `Polowanie nr ${String(seed.number ?? d.number ?? '')}`,
          headerShown: true,
          headerStyle: { backgroundColor: meta.color },
          headerTintColor: '#fff',
          headerRight: () => (
            <IconButton icon="refresh" iconColor="#fff" onPress={refresh} disabled={refreshing} />
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.statusRow}>
          <Chip
            icon={meta.icon}
            style={{ backgroundColor: meta.color }}
            textStyle={{ color: '#fff' }}
          >
            {meta.label}
          </Chip>
        </View>

        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.detailList}>
            {rows
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <View key={label} style={styles.detailRow}>
                  <Text variant="bodyMedium" style={styles.detailLabel}>
                    {label}
                  </Text>
                  <Text variant="bodyMedium" style={styles.detailValue}>
                    {String(value)}
                  </Text>
                </View>
              ))}
          </Card.Content>
        </Card>

        {canManage ? <ShotsCard unitId={unitId} hunt={d} districtId={districtId ?? ''} /> : null}

        <Card mode="outlined" style={styles.card}>
          <Card.Title title="Pozyskana zwierzyna" />
          <Card.Content>
            {animals.length ? (
              animals.map((a, i) => (
                <List.Item key={a.id ?? i} title={animalLabel(a)} left={(p) => <List.Icon {...p} icon="paw" />} />
              ))
            ) : (
              <Text style={styles.muted}>
                {animalsQuery.isLoading ? 'Wczytywanie…' : 'Lista zwierzyny jest pusta.'}
              </Text>
            )}
          </Card.Content>
        </Card>

        {wounded.length ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Title title="Postrzałki" />
            <Card.Content>
              {wounded.map((w, i) => (
                <List.Item
                  key={w.id ?? i}
                  title={animalLabel(w)}
                  left={(p) => <List.Icon {...p} icon="alert-circle-outline" />}
                />
              ))}
            </Card.Content>
          </Card>
        ) : null}

        {canManage || canAddAfterEnd || showCrossOut ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Title title="Zarządzaj polowaniem" />
            <Card.Content style={styles.manage}>
              {canManage || canAddAfterEnd ? (
                <Button mode="contained-tonal" icon="paw" onPress={() => setAddOpen(true)}>
                  Dodaj pozyskanie
                </Button>
              ) : null}
              {showCrossOut ? (
                <Button
                  mode="contained-tonal"
                  icon="close-circle-outline"
                  disabled={!beforeStart}
                  onPress={() => setConfirmCross(true)}
                >
                  Wykreśl polowanie
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  mode="contained"
                  icon="stop-circle-outline"
                  buttonColor={theme.colors.error}
                  onPress={() => setConfirmFinish(true)}
                >
                  Zakończ polowanie
                </Button>
              ) : null}
            </Card.Content>
          </Card>
        ) : d.canEdit === false ? (
          <HelperText type="info" visible style={styles.readonly}>
            Podgląd — nie masz uprawnień do edycji tego polowania.
          </HelperText>
        ) : null}
      </ScrollView>

      <SlotDialog
        visible={addOpen}
        onDismiss={() => setAddOpen(false)}
        title="Dodaj pozyskanie"
        unitId={unitId}
        districtId={districtId ?? ''}
        huntingId={d.id}
        permits={permits}
        grounds={grounds}
      />
      <FinishDialog
        visible={confirmFinish}
        onDismiss={() => setConfirmFinish(false)}
        unitId={unitId}
        hunt={d}
        districtId={districtId ?? ''}
      />
      <CrossOutDialog
        visible={confirmCross}
        onDismiss={() => setConfirmCross(false)}
        unitId={unitId}
        huntingId={d.id}
        districtId={districtId ?? ''}
      />
    </>
  );
}

/** Hunt-level shot count — editable while the hunt is open. */
function ShotsCard({
  unitId,
  hunt,
  districtId,
}: {
  unitId: string;
  hunt: HuntDetail;
  districtId: string | number;
}) {
  const update = useUpdateHunt(unitId);
  // Empty when no shots recorded yet — never default to "0".
  const current = hunt.shotsFired != null ? String(hunt.shotsFired) : '';
  const [shots, setShots] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const dirty = current !== shots.trim();

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        huntingId: hunt.id,
        districtId,
        // Blank → undefined (omitted from JSON), else the user's number.
        shotsFired: shots.trim() === '' ? undefined : Number(shots),
        // Preserve the hunt's current values — otherwise they get blanked.
        notes: hunt.notes ?? '',
        withWoundedAnimals: hunt.withWoundedAnimals ?? false,
        // Resend the existing end date UNCHANGED (never move it to now) — this
        // is what lets shots be edited after the hunt is past its end.
        endDate: hunt.endDate ?? undefined,
        // no `close` → saves without ending the hunt
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    }
  };

  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title="Liczba strzałów" />
      <Card.Content style={styles.shotsRow}>
        <TextInput
          mode="outlined"
          label="Oddane strzały"
          keyboardType="number-pad"
          value={shots}
          onChangeText={setShots}
          style={styles.flex1}
        />
        <Button mode="contained" loading={update.isPending} disabled={!dirty || update.isPending} onPress={save}>
          Zapisz
        </Button>
      </Card.Content>
      {error ? (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      ) : null}
    </Card>
  );
}

/**
 * Add a harvested animal ("pozyskanie"), booked against ONE animal slot of a
 * permit (authorizationAnimalId) in one of the hunt's rewiry (groundId). The
 * harvest time is chosen by the user and MAY be in the past (an animal shot
 * earlier can be logged later).
 */
function SlotDialog({
  visible,
  onDismiss,
  title,
  unitId,
  districtId,
  huntingId,
  permits,
  grounds,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  unitId: string;
  districtId: string | number;
  huntingId: string;
  permits: { id: number; number?: string }[];
  grounds: { huntingGroundId: number; name?: string }[];
}) {
  const [permitId, setPermitId] = useState<number | undefined>(permits[0]?.id);
  const [groundId, setGroundId] = useState<number | undefined>(grounds[0]?.huntingGroundId);
  const [slot, setSlot] = useState<PermitAnimalSlot>();
  const [qty, setQty] = useState('1');
  const [when, setWhen] = useState<Date>(new Date());
  const [pMenu, setPMenu] = useState(false);
  const [gMenu, setGMenu] = useState(false);
  const [sMenu, setSMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = usePermitAnimals(unitId, districtId, permitId);
  const addHarvest = useAddHarvest(unitId);
  const pending = addHarvest.isPending;
  // Survives failed attempts, so pressing Zapisz again cannot double-record.
  const guard = useRef(newHarvestGuard());
  const sending = useRef(false);

  const animalLabelText = (a: PermitAnimalSlot) =>
    `${a.name}${a.igo ? ' · IGO' : ''} · pozostało ${a.remainingNumber}`;
  const permitLabel =
    permits.find((p) => p.id === permitId)?.number?.split(';')[0].trim() ?? 'Wybierz…';
  const groundLabel =
    grounds.find((g) => g.huntingGroundId === groundId)?.name ?? 'Wybierz…';
  const slotLabel = slot ? animalLabelText(slot) : 'Wybierz…';

  const submit = async () => {
    setError(null);
    const count = Number(qty);
    if (!permitId || !groundId || !slot) {
      setError('Wybierz upoważnienie, rewir i zwierzynę.');
      return;
    }
    if (!Number.isInteger(count) || count < 1) {
      setError('Podaj liczbę sztuk (min. 1).');
      return;
    }
    // IGO has no permit cap; permitted animals are limited by remainingNumber.
    if (!slot.igo && count > slot.remainingNumber) {
      setError(`Na upoważnieniu pozostało ${slot.remainingNumber} szt.`);
      return;
    }
    // A second tap while the first is still going must not send again.
    if (sending.current) return;
    sending.current = true;
    try {
      await addHarvest.mutateAsync({
        guard: guard.current,
        huntingId,
        districtId,
        authorizationId: permitId,
        groundId,
        authorizationAnimalId: slot.authorizationAnimalId,
        number: count,
        harvestDate: when.toISOString(),
      });
      guard.current = newHarvestGuard();
      setSlot(undefined);
      setQty('1');
      setWhen(new Date());
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać');
    } finally {
      sending.current = false;
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView contentContainerStyle={styles.dialogContent}>
            <Menu
              visible={pMenu}
              onDismiss={() => setPMenu(false)}
              anchor={
                <TextInput
                  mode="outlined"
                  label="Upoważnienie"
                  editable={false}
                  value={permitLabel}
                  right={<TextInput.Icon icon="menu-down" onPress={() => setPMenu(true)} />}
                  onPressIn={() => setPMenu(true)}
                />
              }
            >
              {permits.map((p) => (
                <Menu.Item
                  key={p.id}
                  title={p.number?.split(';')[0].trim() ?? String(p.id)}
                  onPress={() => {
                    setPermitId(p.id);
                    setSlot(undefined);
                    setPMenu(false);
                  }}
                />
              ))}
            </Menu>

            <Menu
              visible={gMenu}
              onDismiss={() => setGMenu(false)}
              anchor={
                <TextInput
                  mode="outlined"
                  label="Rewir"
                  editable={false}
                  value={groundLabel}
                  right={<TextInput.Icon icon="menu-down" onPress={() => setGMenu(true)} />}
                  onPressIn={() => setGMenu(true)}
                />
              }
            >
              {grounds.map((g) => (
                <Menu.Item
                  key={g.huntingGroundId}
                  title={g.name ?? String(g.huntingGroundId)}
                  onPress={() => {
                    setGroundId(g.huntingGroundId);
                    setGMenu(false);
                  }}
                />
              ))}
            </Menu>

            <Menu
              visible={sMenu}
              onDismiss={() => setSMenu(false)}
              anchor={
                <TextInput
                  mode="outlined"
                  label="Zwierzyna (upoważnienie + IGO)"
                  editable={false}
                  value={slots.isLoading ? 'Wczytywanie…' : slotLabel}
                  right={<TextInput.Icon icon="menu-down" onPress={() => setSMenu(true)} />}
                  onPressIn={() => setSMenu(true)}
                />
              }
            >
              <ScrollView style={styles.menuScroll}>
                {(slots.data ?? []).map((s) => (
                  <Menu.Item
                    key={s.authorizationAnimalId}
                    title={animalLabelText(s)}
                    onPress={() => {
                      setSlot(s);
                      setSMenu(false);
                    }}
                  />
                ))}
                {(slots.data?.length ?? 0) === 0 ? (
                  <Menu.Item
                    title={slots.isLoading ? 'Wczytywanie…' : 'Brak wolnej zwierzyny'}
                    disabled
                  />
                ) : null}
              </ScrollView>
            </Menu>

            {/* Count — how many of this animal were shot. */}
            <TextInput
              mode="outlined"
              label="Liczba sztuk"
              keyboardType="number-pad"
              value={qty}
              onChangeText={setQty}
            />

            {/* Harvest time — defaults to now, but may be set in the past. */}
            <DateTimeField label="Data i godzina pozyskania" value={when} onChange={setWhen} />

            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Anuluj</Button>
          <Button mode="contained" loading={pending} disabled={pending} onPress={submit}>
            Zapisz
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function FinishDialog({
  visible,
  onDismiss,
  unitId,
  hunt,
  districtId,
}: {
  visible: boolean;
  onDismiss: () => void;
  unitId: string;
  hunt: HuntDetail;
  districtId: string | number;
}) {
  const update = useUpdateHunt(unitId);
  // Keep whatever was already recorded during the hunt; blank if none (not "0").
  const [shots, setShots] = useState(hunt.shotsFired != null ? String(hunt.shotsFired) : '');
  const [notes, setNotes] = useState(hunt.notes ?? '');
  const [wounded, setWounded] = useState(hunt.withWoundedAnimals ?? false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        huntingId: hunt.id,
        districtId,
        // Blank → undefined (omitted), else the user's number.
        shotsFired: shots.trim() === '' ? undefined : Number(shots),
        notes: notes.trim(),
        withWoundedAnimals: wounded,
        // Planned end → close stamps min(planned end, now).
        endDate: hunt.endDate ?? undefined,
        close: true,
      });
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zakończyć');
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Zakończyć polowanie?</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView contentContainerStyle={styles.dialogContent}>
            <Text variant="bodySmall" style={styles.muted}>
              Wpis zostanie zamknięty (wypisanie z książki ewidencji).
            </Text>
            <TextInput
              mode="outlined"
              label="Liczba strzałów"
              keyboardType="number-pad"
              value={shots}
              onChangeText={setShots}
            />
            <TextInput
              mode="outlined"
              label="Uwagi od myśliwego"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <Checkbox.Item
              label="Polowanie z postrzałkiem"
              status={wounded ? 'checked' : 'unchecked'}
              onPress={() => setWounded((w) => !w)}
              position="leading"
            />
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Anuluj</Button>
          <Button
            mode="contained"
            loading={update.isPending}
            disabled={update.isPending}
            onPress={confirm}
            textColor="#fff"
            buttonColor="#c62828"
          >
            Zakończ
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

/** Wykreślenie — confirm crossing yourself out of a signed-up hunt. */
function CrossOutDialog({
  visible,
  onDismiss,
  unitId,
  huntingId,
  districtId,
}: {
  visible: boolean;
  onDismiss: () => void;
  unitId: string;
  huntingId: string;
  districtId: string | number;
}) {
  const del = useDeleteHunt(unitId);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      await del.mutateAsync({ huntingId, districtId });
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wykreślić');
    }
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>Wykreślić polowanie?</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={styles.muted}>
            Czy na pewno chcesz wykreślić polowanie? Wpis zostanie oznaczony jako
            wykreślony.
          </Text>
          {error ? (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Anuluj</Button>
          <Button
            mode="contained"
            loading={del.isPending}
            onPress={confirm}
            buttonColor="#c62828"
            textColor="#fff"
          >
            Wykreśl
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // Generous bottom padding so the manage buttons clear the nav bar and are
  // comfortably reachable when the page is long.
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  statusRow: { flexDirection: 'row' },
  card: { borderRadius: 14 },
  detailList: { gap: 0 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  detailLabel: { opacity: 0.6, flexShrink: 0 },
  detailValue: { flex: 1, textAlign: 'right', flexWrap: 'wrap' },
  manage: { gap: 10 },
  muted: { opacity: 0.6 },
  readonly: { textAlign: 'center' },
  menuScroll: { maxHeight: 300 },
  dialog: { maxHeight: '85%' },
  dialogContent: { gap: 12, paddingVertical: 8 },
  shotsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingBottom: 10 },
  flex1: { flex: 1 },
});
