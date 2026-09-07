import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import {
  Appbar,
  Button,
  Checkbox,
  Divider,
  IconButton,
  List,
  Portal,
  RadioButton,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HuntingMap } from '@/map/HuntingMap';
import type { MapCamera } from '@/map/HuntingMap';
import { BASE_LAYERS, OVERLAY_LAYERS } from '@/map/layers';
import { type VectorOverlay } from '@/map/style';
import { DataAge } from '@/components/offline';
import { useMapSettings } from '@/features/map/settings';
import { useDistrictsGeo, useRewirsGeo } from '@/features/map/geo';
import {
  deviceColor,
  devicesToGeo,
  visibleDevices,
  useDeviceTypes,
  useHuntingDevices,
  type Device,
} from '@/features/map/devices';
import { useHuntingDistrictOptions, useHuntingYears } from '@/features/huntingBook/lookups';
import {
  isCurrentlyHunting,
  rewirName,
  type BookPage,
} from '@/features/huntingBook/book';
import { useUnits } from '@/units/UnitProvider';

const DISTRICT_COLOR = '#2f6b26';
const REWIR_COLOR = '#1565c0';
const DEVICE_COLOR = '#f57c00';

function nearestDevice(
  devices: Device[],
  coord: { longitude: number; latitude: number },
  maxDist: number,
): Device | null {
  let best: Device | null = null;
  let bestD = maxDist;
  for (const d of devices) {
    const c = d.marker?.coordinates;
    if (!c || c.length < 2) continue;
    const dist = Math.hypot(c[0] - coord.longitude, c[1] - coord.latitude);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/**
 * A CURRENT position. `getCurrentPositionAsync` ACTIVELY asks the phone's GPS for
 * a fresh fix (unlike `getLastKnownPositionAsync`, the cached point that caused
 * the "old spot until restart" bug). The button passes High accuracy to force a
 * real GPS lock ("locate me now"); the auto-recenter uses Balanced to save
 * battery. Capped so it never hangs — last-known only as a timeout fallback.
 */
async function getFreshPosition(
  accuracy: Location.LocationAccuracy = Location.Accuracy.Balanced,
  timeoutMs = 8000,
): Promise<Location.LocationObject | null> {
  const fresh = Location.getCurrentPositionAsync({ accuracy });
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const pos = await Promise.race([fresh, timeout]).catch(() => null);
  return pos ?? (await Location.getLastKnownPositionAsync().catch(() => null));
}

export default function MapScreen() {
  const theme = useTheme();
  const { activeUnitId, activeUnit } = useUnits();
  const unitId = activeUnitId ?? '';
  const { settings, loaded, update, toggleRasterOverlay } = useMapSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [flyTo, setFlyTo] = useState<MapCamera | null>(null);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState<Device | null>(null);

  // Center the map on the user's CURRENT location (fresh fix). One-shot flyTo —
  // it clears after 1s so it never fights gestures.
  const centerOnMe = useCallback(async () => {
    let granted = false;
    try {
      const cur = await Location.getForegroundPermissionsAsync();
      granted = cur.granted
        ? true
        : (await Location.requestForegroundPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    setLocationGranted(granted);
    if (!granted) return;
    const pos = await getFreshPosition();
    if (!pos) return;
    setFlyTo({
      longitude: pos.coords.longitude,
      latitude: pos.coords.latitude,
      zoom: 14,
    });
    setTimeout(() => setFlyTo(null), 1000);
  }, []);

  // Re-center on a FRESH fix every time the map screen gains focus — not just on
  // first mount. This is what fixes "tab back and it's still the old spot": each
  // return to the map pulls a current position instead of trusting a stale one.
  useFocusEffect(
    useCallback(() => {
      centerOnMe();
    }, [centerOnMe]),
  );

  const years = useHuntingYears();
  const year = years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value;

  const districts = useDistrictsGeo(unitId, year, settings.showDistricts);
  const districtOptions = useHuntingDistrictOptions(unitId);
  const districtIds = useMemo(
    () => (districtOptions.data ?? []).map((d) => d.id),
    [districtOptions.data],
  );
  const rewirs = useRewirsGeo(unitId, districtIds, settings.showRewirs);
  const devices = useHuntingDevices(unitId, year, settings.showDevices);
  const deviceTypes = useDeviceTypes(unitId);

  // Occupied rewiry ("gdzie ktoś teraz poluje") — derived from the HUNT-PANEL
  // (book) data we ALREADY have cached; no separate download. Recomputed
  // reactively whenever the book cache changes (the map reload refetches it).
  const qc = useQueryClient();
  const [occupiedNames, setOccupiedNames] = useState<string[]>([]);
  useEffect(() => {
    const compute = () => {
      const set = new Set<string>();
      for (const [, data] of qc.getQueriesData<InfiniteData<BookPage>>({
        queryKey: ['book', unitId],
      })) {
        for (const page of data?.pages ?? []) {
          for (const e of page.entries) {
            if (isCurrentlyHunting(e)) {
              const n = rewirName(e.huntingPlace);
              if (n) set.add(n);
            }
          }
        }
      }
      const next = [...set].sort();
      setOccupiedNames((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
      );
    };
    compute();
    return qc.getQueryCache().subscribe(compute);
  }, [qc, unitId]);
  const occupiedSet = useMemo(() => new Set(occupiedNames), [occupiedNames]);

  const activeRasterKeys = useMemo(() => {
    const keys = new Set<string>([settings.baseLayerKey]);
    for (const l of OVERLAY_LAYERS) if (settings.rasterOverlays[l.key]) keys.add(l.key);
    return keys;
  }, [settings.baseLayerKey, settings.rasterOverlays]);

  const vectorOverlays = useMemo<VectorOverlay[]>(() => {
    const out: VectorOverlay[] = [];
    if (settings.showDistricts && districts.data) {
      out.push({
        key: 'districts',
        kind: 'polygon',
        data: districts.data,
        color: DISTRICT_COLOR,
        labelKeys: ['number'],
      });
    }
    if (settings.showRewirs && rewirs.data) {
      // Tag each rewir with `occupied` (someone hunting there now) so the layer
      // can paint it red — derived from the cached book data, matched by name.
      const fc = rewirs.data as GeoJSON.FeatureCollection;
      const data: GeoJSON.FeatureCollection = {
        ...fc,
        features: fc.features.map((f) => ({
          ...f,
          properties: {
            ...(f.properties ?? {}),
            occupied: occupiedSet.has(String(f.properties?.name ?? '')),
          },
        })),
      };
      out.push({
        key: 'rewirs',
        kind: 'polygon',
        data,
        color: REWIR_COLOR,
        labelKeys: ['name'],
      });
    }
    if (settings.showDevices && devices.data) {
      out.push({
        key: 'devices',
        kind: 'point',
        data: devicesToGeo(devices.data, settings.deviceTypeIds),
        color: DEVICE_COLOR,
      });
    }
    return out;
    // Depend on the specific fields used — NOT the whole `settings` object, which
    // changes on every camera move (camera is persisted in settings). Depending
    // on all of `settings` here rebuilt the overlays (and thus the map style) on
    // every pan, reloading the map and snapping the camera back to the last
    // programmatic target — a feedback loop after tapping "locate".
  }, [
    settings.showDistricts,
    settings.showRewirs,
    settings.showDevices,
    settings.deviceTypeIds,
    districts.data,
    rewirs.data,
    devices.data,
    occupiedSet,
  ]);

  // Which device types to show in the legend (respects the filter).
  const legendTypes = useMemo(() => {
    const all = deviceTypes.data ?? [];
    return settings.deviceTypeIds.length
      ? all.filter((t) => settings.deviceTypeIds.includes(t.value))
      : all;
  }, [deviceTypes.data, settings.deviceTypeIds]);

  // One-shot fly to the given camera: apply it, then release so the user can
  // freely pan/zoom afterwards (a lingering target must never fight gestures).
  const flyOnce = (cam: MapCamera) => {
    setFlyTo(cam);
    setTimeout(() => setFlyTo(null), 1000);
  };

  const onLocate = async () => {
    if (locating) return; // ignore taps while a fix is in flight (no queueing)
    setLocating(true);
    try {
      if (!locationGranted) {
        const r = await Location.requestForegroundPermissionsAsync();
        setLocationGranted(r.granted);
        if (!r.granted) {
          setSnack('Brak zgody na dostęp do lokalizacji.');
          return;
        }
      }
      // Button = force a real GPS lock (High), with a longer window.
      const pos = await getFreshPosition(Location.Accuracy.High, 12000);
      if (!pos) {
        setSnack('Nie udało się ustalić lokalizacji.');
        return;
      }
      flyOnce({ longitude: pos.coords.longitude, latitude: pos.coords.latitude, zoom: 14 });
    } catch {
      setSnack('Nie udało się ustalić lokalizacji.');
    } finally {
      setLocating(false);
    }
  };

  const onMapPress = (coord: { longitude: number; latitude: number }) => {
    if (!devices.data || !settings.showDevices) {
      setSelected(null);
      return;
    }
    const zoom = settings.camera?.zoom ?? 12;
    const maxDist = 80 / Math.pow(2, zoom); // tap tolerance scales with zoom
    // Only consider devices that are actually VISIBLE (filtered), so a tap never
    // selects a type the user has turned off (e.g. finding a lizawka while only
    // ambony/zwyżki are shown).
    const visible = visibleDevices(devices.data, settings.deviceTypeIds);
    setSelected(nearestDevice(visible, coord, maxDist));
  };

  const onRefresh = () => {
    // The reload button is the ONLY thing that refreshes the map — refetch every
    // layer (the queries never auto-refetch; see geo.ts / devices.ts).
    devices.refetch();
    districts.refetch();
    rewirs.refetch();
    deviceTypes.refetch();
    years.refetch();
    // Also refresh the hunt-panel (book) data — that's what the occupied-rewiry
    // highlight is derived from, so a map refresh keeps "who's hunting where"
    // current (and updates the hunt page too).
    qc.refetchQueries({ queryKey: ['book', unitId] });
    setSnack('Odświeżanie danych…');
  };

  const toggleDeviceType = (typeId: number) =>
    update({
      deviceTypeIds: settings.deviceTypeIds.includes(typeId)
        ? settings.deviceTypeIds.filter((t) => t !== typeId)
        : [...settings.deviceTypeIds, typeId],
    });

  if (!loaded) return <View style={styles.root} />;
  const fetching = devices.isFetching || districts.isFetching;

  return (
    <View style={styles.root}>
      {/* Appbar.Header applies its own status-bar inset — no extra SafeAreaView
          (that would double the inset and leave the status bar over a bare white
          background). */}
      <Appbar.Header mode="small" elevated>
        <Appbar.Content title="Mapa" subtitle={activeUnit?.name} />
        <View style={styles.age}>
          <DataAge
            updatedAt={devices.dataUpdatedAt || districts.dataUpdatedAt}
            isFetching={fetching}
          />
        </View>
        <Appbar.Action icon="refresh" onPress={onRefresh} disabled={fetching} />
      </Appbar.Header>

      <View style={styles.mapArea}>
        <HuntingMap
          activeRasterKeys={activeRasterKeys}
          vectorOverlays={vectorOverlays}
          initialCamera={settings.camera}
          onCameraChange={(camera) => update({ camera })}
          showUserLocation={locationGranted}
          flyTo={flyTo}
          onMapPress={onMapPress}
          highlight={
            selected?.marker?.coordinates?.length === 2
              ? {
                  longitude: selected.marker.coordinates[0],
                  latitude: selected.marker.coordinates[1],
                }
              : null
          }
        />

        <View style={styles.topRight} pointerEvents="box-none">
          <IconButton icon="layers" mode="contained" size={24} onPress={() => setPanelOpen((o) => !o)} style={styles.fab} />
          <IconButton icon="crosshairs-gps" mode="contained" size={24} loading={locating} disabled={locating} onPress={onLocate} style={styles.fab} />
        </View>

        {settings.showDevices && legendTypes.length ? (
          <Surface style={styles.legend} elevation={3}>
            {legendTypes.map((t) => (
              <View key={t.value} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: deviceColor(t.value) }]} />
                <Text variant="labelSmall">{t.label}</Text>
              </View>
            ))}
          </Surface>
        ) : null}

        {selected ? (
          <Surface style={styles.deviceCard} elevation={4}>
            <View style={styles.deviceHeader}>
              <View style={[styles.legendDot, { backgroundColor: deviceColor(selected.registerTypeId) }]} />
              <View style={styles.flex1}>
                <Text variant="titleMedium" style={styles.bold}>
                  {selected.registerName ?? 'Urządzenie'}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {selected.registerTypeName ?? 'Urządzenie łowieckie'}
                  {selected.number ? ` · nr ${selected.number}` : ''}
                </Text>
              </View>
              <IconButton icon="close" size={20} onPress={() => setSelected(null)} />
            </View>
          </Surface>
        ) : null}
      </View>

      {panelOpen ? (
        <Portal>
          <SafeAreaView style={styles.panelWrap} pointerEvents="box-none">
            <Surface style={styles.panel} elevation={4}>
              <ScrollView>
                <View style={styles.panelHeader}>
                  <Text variant="titleMedium" style={styles.bold}>
                    Warstwy mapy
                  </Text>
                  <IconButton icon="close" onPress={() => setPanelOpen(false)} />
                </View>

                <Text variant="labelSmall" style={styles.section}>
                  PODKŁAD
                </Text>
                <RadioButton.Group value={settings.baseLayerKey} onValueChange={(v) => update({ baseLayerKey: v })}>
                  {BASE_LAYERS.map((l) => (
                    <RadioButton.Item key={l.key} label={l.title} value={l.key} />
                  ))}
                </RadioButton.Group>

                <Divider />
                <Text variant="labelSmall" style={styles.section}>
                  WARSTWY RASTROWE
                </Text>
                {OVERLAY_LAYERS.map((l) => (
                  <Checkbox.Item
                    key={l.key}
                    label={l.title}
                    status={settings.rasterOverlays[l.key] ? 'checked' : 'unchecked'}
                    onPress={() => toggleRasterOverlay(l.key)}
                  />
                ))}

                <Divider />
                <Text variant="labelSmall" style={styles.section}>
                  DANE KOŁA
                </Text>
                <Checkbox.Item
                  label="Obwody łowieckie"
                  status={settings.showDistricts ? 'checked' : 'unchecked'}
                  onPress={() => update({ showDistricts: !settings.showDistricts })}
                />
                <Checkbox.Item
                  label={`Rewiry${rewirs.data ? ` (${rewirs.data.features.length})` : ''}`}
                  status={settings.showRewirs ? 'checked' : 'unchecked'}
                  onPress={() => update({ showRewirs: !settings.showRewirs })}
                />
                <Checkbox.Item
                  label={`Urządzenia łowieckie${devices.data ? ` (${devices.data.length})` : ''}`}
                  status={settings.showDevices ? 'checked' : 'unchecked'}
                  onPress={() => update({ showDevices: !settings.showDevices })}
                />

                {settings.showDevices && (deviceTypes.data?.length ?? 0) > 0 ? (
                  <List.Accordion title="Typy urządzeń (filtr)" id="device-filter">
                    {(deviceTypes.data ?? []).map((t) => {
                      const checked =
                        settings.deviceTypeIds.length === 0 || settings.deviceTypeIds.includes(t.value);
                      return (
                        <View key={t.value} style={styles.typeRow}>
                          <View style={[styles.legendDot, { backgroundColor: deviceColor(t.value) }]} />
                          <Checkbox.Item
                            label={t.label}
                            status={checked ? 'checked' : 'unchecked'}
                            onPress={() => toggleDeviceType(t.value)}
                            style={styles.flex1}
                          />
                        </View>
                      );
                    })}
                    {settings.deviceTypeIds.length > 0 ? (
                      <Button onPress={() => update({ deviceTypeIds: [] })}>Pokaż wszystkie typy</Button>
                    ) : null}
                  </List.Accordion>
                ) : null}

                <Divider style={styles.mt} />
                <Text variant="bodySmall" style={styles.note}>
                  Mapa zapisuje się automatycznie podczas przeglądania — obszary,
                  które oglądałeś, są dostępne offline.
                </Text>
              </ScrollView>
            </Surface>
          </SafeAreaView>
        </Portal>
      ) : null}

      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)} duration={2500}>
        {snack ?? ''}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  age: { flex: 1, alignItems: 'flex-end', paddingRight: 4 },
  mapArea: { flex: 1 },
  topRight: { position: 'absolute', top: 8, right: 4 },
  fab: { margin: 6, marginBottom: 0 },
  legend: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  deviceCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 16,
    padding: 4,
  },
  deviceHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12 },
  panelWrap: { flex: 1, justifyContent: 'flex-end' },
  panel: { margin: 12, borderRadius: 16, paddingHorizontal: 4, paddingBottom: 12, maxHeight: '80%' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12 },
  section: { marginTop: 8, marginBottom: 2, marginLeft: 16, opacity: 0.6 },
  bold: { fontWeight: '700' },
  muted: { opacity: 0.6 },
  mt: { marginTop: 8 },
  note: { opacity: 0.6, paddingHorizontal: 16, paddingTop: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center' },
  flex1: { flex: 1 },
});
