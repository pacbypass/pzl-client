import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useOnForeground } from '@/hooks/useOnForeground';
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
import { OCCUPIED_COLOR, type VectorOverlay } from '@/map/style';
import { DataAge } from '@/components/offline';
import { useMapSettings } from '@/features/map/settings';
import { centroidOf, useDistrictsGeo, useRewirsGeo } from '@/features/map/geo';
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
  useOccupiedRewirs,
  type OccupiedRewir,
} from '@/features/map/occupied';
import { normalizeRewir } from '@/features/huntingBook/book';
import { usePublishCarMap } from '@/features/map/carBridge';
import { useUnits } from '@/units/UnitProvider';

const DISTRICT_COLOR = '#2f6b26';
const REWIR_COLOR = '#1565c0';
const DEVICE_COLOR = '#f57c00';

/** Start/end of a hunt: "14:20" when it is today, else "07.09, 14:20". */
function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const today =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (today) return time;
  const day = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  return `${day}, ${time}`;
}

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
  /** Follow-me: the map keeps the user centred as they drive. */
  const [following, setFollowing] = useState(false);
  /** Zoom following starts at: the user's own, unless too far out to drive by. */
  const [followZoom, setFollowZoom] = useState(14);
  const [selected, setSelected] = useState<Device | null>(null);

  // Ask for (or read) the location permission — needed for the blue dot even
  // when we are not moving the camera.
  const ensureLocationPermission = useCallback(async () => {
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
    return granted;
  }, []);

  // Center the map on the user's CURRENT location (fresh fix). One-shot flyTo —
  // it clears after 1s so it never fights gestures.
  const centerOnMe = useCallback(async () => {
    if (!(await ensureLocationPermission())) return;
    const pos = await getFreshPosition();
    if (!pos) return;
    setFlyTo({
      longitude: pos.coords.longitude,
      latitude: pos.coords.latitude,
      zoom: 14,
    });
    setTimeout(() => setFlyTo(null), 1000);
  }, [ensureLocationPermission]);

  // The map RESTORES THE LAST VIEW. Coming back to the tab (or reloading the
  // data) must never move the camera — the saved camera is what the user was
  // looking at, and it is handed to the map as its initial camera. Only a map
  // that has never been used has nowhere to start, and only then do we jump to
  // the current position; otherwise just make sure the blue dot can show. The
  // crosshair button is how the user asks to be re-centred.
  const autoCentered = useRef(false);
  useEffect(() => {
    if (!loaded || autoCentered.current) return;
    autoCentered.current = true;
    if (settings.camera) void ensureLocationPermission();
    else void centerOnMe();
  }, [loaded, settings.camera, centerOnMe, ensureLocationPermission]);

  const years = useHuntingYears();
  const year = years.data?.find((y) => y.isActual)?.value ?? years.data?.[0]?.value;

  const districts = useDistrictsGeo(unitId, year, settings.showDistricts);
  const districtOptions = useHuntingDistrictOptions(unitId);
  const districtOpts = useMemo(
    () => districtOptions.data ?? [],
    [districtOptions.data],
  );
  const districtIds = useMemo(() => districtOpts.map((d) => d.id), [districtOpts]);
  // The rewir polygons are also what the occupied list flies to, so they load
  // whenever either layer is on.
  const rewirs = useRewirsGeo(
    unitId,
    districtIds,
    settings.showRewirs || settings.showOccupied,
  );
  const devices = useHuntingDevices(unitId, year, settings.showDevices);
  const deviceTypes = useDeviceTypes(unitId);

  // Occupied rewiry ("gdzie ktoś teraz poluje") — the map PULLS the hunt data
  // itself (książka ewidencji, every obwód of the koło), so the highlight is
  // right even if the user never opened the Polowania tab.
  const occupied = useOccupiedRewirs(unitId, year, districtOpts, settings.showOccupied);
  const [selectedRewir, setSelectedRewir] = useState<OccupiedRewir | null>(null);

  // Refresh occupancy when the map comes back into view, but only once it has
  // gone stale — tab screens stay mounted, so react-query's refetchOnMount
  // never fires for them.
  const occupiedRef = useRef(occupied.query);
  occupiedRef.current = occupied.query;
  const refreshOccupiedIfStale = useCallback(() => {
    const q = occupiedRef.current;
    if (q.isStale && !q.isFetching) void q.refetch();
  }, []);
  const mapFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      mapFocused.current = true;
      refreshOccupiedIfStale();
      return () => {
        mapFocused.current = false;
      };
    }, [refreshOccupiedIfStale]),
  );
  // …and when the app returns from the background with the map in front, which
  // focus alone does not catch. Other tabs' screens stay mounted too, so only
  // refresh when the map is the one being looked at.
  useOnForeground(() => {
    if (mapFocused.current) refreshOccupiedIfStale();
  });

  // A failed occupancy refresh keeps the last known data on the map; say so,
  // rather than let old data pass for current.
  const occupiedErrorAt = occupied.query.errorUpdatedAt;
  useEffect(() => {
    if (!occupiedErrorAt) return;
    const at = occupied.query.dataUpdatedAt;
    setSnack(
      at
        ? `Nie udało się odświeżyć zajętych rewirów — dane z ${new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.`
        : 'Nie udało się pobrać zajętych rewirów.',
    );
    // Only a new failure should raise the message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupiedErrorAt]);

  // Occupied rewiry indexed by their normalized label ("13 C" → "13C"). A label
  // repeats across obwody, so a match must agree on the obwód too — unless the
  // polygons carry no district id (or the two endpoints number districts
  // differently, handled by the `loose` pass below), in which case the label
  // alone is all there is to go on.
  const occupiedByName = useMemo(() => {
    const m = new Map<string, OccupiedRewir[]>();
    for (const r of occupied.rewirs) {
      const list = m.get(r.key);
      if (list) list.push(r);
      else m.set(r.key, [r]);
    }
    return m;
  }, [occupied.rewirs]);

  const isOccupied = useCallback(
    (name: string, districtId: string, loose: boolean) => {
      const list = occupiedByName.get(normalizeRewir(name));
      if (!list?.length) return false;
      if (loose || !districtId) return true;
      return list.some(
        (r) => r.districtKeys.length === 0 || r.districtKeys.includes(districtId),
      );
    },
    [occupiedByName],
  );

  /**
   * The polygons of the rewiry that are taken — drawn as their OWN red overlay
   * on top of the plain rewir layer, so the highlight is plain paint rather
   * than a data-driven style expression (and shows even with the rewir layer
   * switched off).
   */
  const occupiedGeo = useMemo(() => {
    const fc = rewirs.data as GeoJSON.FeatureCollection | undefined;
    if (!fc || !settings.showOccupied || occupied.rewirs.length === 0) return undefined;
    const pick = (loose: boolean) =>
      fc.features.filter((f) =>
        isOccupied(
          String(f.properties?.name ?? ''),
          String(f.properties?.districtId ?? ''),
          loose,
        ),
      );
    // Nothing matched although hunts ARE running: the polygons' district ids
    // don't line up with the book's. Fall back to matching on the rewir label
    // alone rather than highlighting nothing.
    const features = pick(false);
    return {
      type: 'FeatureCollection' as const,
      features: features.length ? features : pick(true),
    };
  }, [rewirs.data, isOccupied, occupied.rewirs.length, settings.showOccupied]);

  /** Centre of each rewir polygon — where the "kto tu poluje" marker goes. */
  const rewirCenters = useMemo(() => {
    const byKey = new Map<string, MapCamera>();
    const fc = rewirs.data as GeoJSON.FeatureCollection | undefined;
    for (const f of fc?.features ?? []) {
      const p = f.properties ?? {};
      // The API's own `centerPoint`, with the polygon's mean as a fallback.
      const c =
        typeof p.centerLng === 'number' && typeof p.centerLat === 'number'
          ? { longitude: p.centerLng, latitude: p.centerLat }
          : centroidOf(f.geometry);
      if (!c) continue;
      const name = normalizeRewir(String(p.name ?? ''));
      const district = String(p.districtId ?? '');
      const cam = { ...c, zoom: 13 };
      byKey.set(`${district}|${name}`, cam);
      if (!byKey.has(name)) byKey.set(name, cam); // label-only fallback
    }
    return byKey;
  }, [rewirs.data]);

  /**
   * One tappable marker in the middle of every taken rewir — tapping it says who
   * is hunting there. It sits ON the red polygon, and because the tap handler
   * picks whichever is CLOSER (marker or device), an ambona inside the same
   * rewir stays selectable as before.
   */
  const occupiedMarkers = useMemo(() => {
    if (!settings.showOccupied) return [];
    const out: { rewir: OccupiedRewir; longitude: number; latitude: number }[] = [];
    for (const r of occupied.rewirs) {
      const cam =
        r.districtKeys.map((k) => rewirCenters.get(`${k}|${r.key}`)).find(Boolean) ??
        rewirCenters.get(r.key);
      if (cam) out.push({ rewir: r, longitude: cam.longitude, latitude: cam.latitude });
    }
    return out;
  }, [occupied.rewirs, rewirCenters, settings.showOccupied]);

  const occupiedPointsGeo = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: occupiedMarkers.map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
        properties: { color: OCCUPIED_COLOR, name: m.rewir.name },
      })),
    }),
    [occupiedMarkers],
  );

  // A selected rewir that stops being occupied (someone wrote out) must not stay
  // pinned open with stale names.
  useEffect(() => {
    if (!selectedRewir) return;
    const fresh = occupied.rewirs.find(
      (r) => r.key === selectedRewir.key && r.districtId === selectedRewir.districtId,
    );
    if (fresh !== selectedRewir) setSelectedRewir(fresh ?? null);
  }, [occupied.rewirs, selectedRewir]);

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
      out.push({
        key: 'rewirs',
        kind: 'polygon',
        data: rewirs.data,
        color: REWIR_COLOR,
        labelKeys: ['name'],
      });
    }
    if (occupiedGeo) {
      out.push({
        key: 'rewirs-occupied',
        kind: 'polygon',
        data: occupiedGeo,
        color: OCCUPIED_COLOR,
        fillOpacity: 0.45,
        lineWidth: 3,
        // The plain rewir layer already labels every polygon; only label here
        // when it is switched off, so the number is never drawn twice.
        labelKeys: settings.showRewirs ? undefined : ['name'],
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
    if (occupiedPointsGeo.features.length) {
      out.push({
        key: 'occupied-markers',
        kind: 'point',
        data: occupiedPointsGeo,
        color: OCCUPIED_COLOR,
        circleRadius: 10, // bigger than a device dot — it is the "who is here" pin
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
    occupiedGeo,
    occupiedPointsGeo,
    devices.data,
  ]);

  // Which device types to show in the legend (respects the filter).
  const legendTypes = useMemo(() => {
    const all = deviceTypes.data ?? [];
    return settings.deviceTypeIds.length
      ? all.filter((t) => settings.deviceTypeIds.includes(t.value))
      : all;
  }, [deviceTypes.data, settings.deviceTypeIds]);

  /**
   * The locate button toggles follow-me: the map centres on the user and
   * keeps them centred as they move. Tapping it again — or dragging the map —
   * stops following.
   */
  const onLocate = async () => {
    if (following) {
      setFollowing(false);
      return;
    }
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
      // MapLibre's tracking moves the camera to the user itself. No separate
      // fly-in: clearing a fly-in's camera target cancels tracking at once.
      const zoom = settings.camera?.zoom ?? 0;
      setFollowZoom(zoom < 12 ? 14 : zoom);
      setFollowing(true);
    } catch {
      setSnack('Nie udało się ustalić lokalizacji.');
    } finally {
      setLocating(false);
    }
  };

  const onMapPress = (coord: { longitude: number; latitude: number }) => {
    const zoom = settings.camera?.zoom ?? 12;
    const maxDist = 80 / Math.pow(2, zoom); // tap tolerance scales with zoom

    // Nearest "kto tu poluje" marker…
    let rewirHit: { rewir: OccupiedRewir; dist: number } | null = null;
    for (const m of occupiedMarkers) {
      const d = Math.hypot(m.longitude - coord.longitude, m.latitude - coord.latitude);
      if (d < maxDist && (!rewirHit || d < rewirHit.dist)) {
        rewirHit = { rewir: m.rewir, dist: d };
      }
    }

    // …and nearest hunting device. Only devices that are actually VISIBLE
    // (filtered) count, so a tap never selects a type the user turned off.
    const visible =
      devices.data && settings.showDevices
        ? visibleDevices(devices.data, settings.deviceTypeIds)
        : [];
    const device = nearestDevice(visible, coord, maxDist);
    const dc = device?.marker?.coordinates;
    const deviceDist = dc
      ? Math.hypot(dc[0] - coord.longitude, dc[1] - coord.latitude)
      : Infinity;

    // Closer one wins, so an ambona standing inside a taken rewir is still
    // reachable even though the rewir marker sits in the middle of it.
    if (rewirHit && rewirHit.dist <= deviceDist) {
      setSelectedRewir(rewirHit.rewir);
      setSelected(null);
    } else {
      setSelected(device);
      setSelectedRewir(null);
    }
  };

  const onRefresh = () => {
    // The reload button is the ONLY thing that refreshes the map — refetch every
    // layer (the queries never auto-refetch; see geo.ts / devices.ts).
    devices.refetch();
    districts.refetch();
    rewirs.refetch();
    deviceTypes.refetch();
    years.refetch();
    // …including the hunt data behind the occupied-rewiry highlight, so a map
    // refresh also refreshes "who is hunting where right now".
    occupied.query.refetch();
    setSnack('Odświeżanie danych…');
  };

  const toggleDeviceType = (typeId: number) =>
    update({
      deviceTypeIds: settings.deviceTypeIds.includes(typeId)
        ? settings.deviceTypeIds.filter((t) => t !== typeId)
        : [...settings.deviceTypeIds, typeId],
    });

  // Hand the current map to the Android Auto car app (Android only, best
  // effort — see carBridge). Nothing on this screen depends on it.
  usePublishCarMap({
    activeRasterKeys,
    vectorOverlays,
    markers: occupiedMarkers,
    camera: settings.camera,
    unitName: activeUnit?.name,
    enabled: loaded,
  });

  const selectedMarker = selectedRewir
    ? occupiedMarkers.find((m) => m.rewir === selectedRewir)
    : null;

  if (!loaded) return <View style={styles.root} />;
  const fetching =
    devices.isFetching || districts.isFetching || occupied.query.isFetching;

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
          followUser={following && locationGranted}
          followZoom={followZoom}
          onFollowUserChange={(on) => {
            if (!on) setFollowing(false);
          }}
          onMapPress={onMapPress}
          highlight={
            selected?.marker?.coordinates?.length === 2
              ? {
                  longitude: selected.marker.coordinates[0],
                  latitude: selected.marker.coordinates[1],
                }
              : selectedMarker
                ? { longitude: selectedMarker.longitude, latitude: selectedMarker.latitude }
                : null
          }
        />

        <View style={styles.topRight} pointerEvents="box-none">
          <IconButton icon="layers" mode="contained" size={24} onPress={() => setPanelOpen((o) => !o)} style={styles.fab} />
          <IconButton
            icon={following ? 'navigation' : 'crosshairs-gps'}
            mode="contained"
            size={24}
            loading={locating}
            disabled={locating}
            onPress={onLocate}
            // Filled green while following, so it is clear the map will move.
            containerColor={following ? theme.colors.primary : undefined}
            iconColor={following ? theme.colors.onPrimary : undefined}
            accessibilityLabel={following ? 'Przestań śledzić lokalizację' : 'Śledź moją lokalizację'}
            style={styles.fab}
          />
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

        {selectedRewir ? (
          <Surface style={styles.deviceCard} elevation={4}>
            <View style={styles.deviceHeader}>
              <View style={[styles.legendDot, styles.occupiedDot]} />
              <View style={styles.flex1}>
                <Text variant="titleMedium" style={styles.bold}>
                  Rewir {selectedRewir.name}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  Obwód {selectedRewir.districtLabel} · zajęty
                </Text>
              </View>
              <IconButton icon="close" size={20} onPress={() => setSelectedRewir(null)} />
            </View>
            <View style={styles.hunters}>
              {selectedRewir.hunters.map((h) => (
                <Text key={h.id} variant="bodyMedium">
                  {h.name} · {h.upcoming ? 'zapisany od' : 'od'} {fmtTime(h.startDate)}
                  {h.overdue ? ' · po czasie' : ''}
                </Text>
              ))}
            </View>
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
                  label={`Zajęte rewiry${
                    occupied.query.data ? ` (${occupied.rewirs.length})` : ''
                  }`}
                  status={settings.showOccupied ? 'checked' : 'unchecked'}
                  onPress={() => update({ showOccupied: !settings.showOccupied })}
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
  occupiedDot: { backgroundColor: OCCUPIED_COLOR, width: 14, height: 14, borderRadius: 7 },
  hunters: { paddingHorizontal: 14, paddingBottom: 12, gap: 2 },
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
  panelAge: { alignItems: 'flex-start', paddingTop: 2, paddingBottom: 4 },
  section: { marginTop: 8, marginBottom: 2, marginLeft: 16, opacity: 0.6 },
  bold: { fontWeight: '700' },
  muted: { opacity: 0.6 },
  mt: { marginTop: 8 },
  note: { opacity: 0.6, paddingHorizontal: 16, paddingTop: 8 },
  typeRow: { flexDirection: 'row', alignItems: 'center' },
  flex1: { flex: 1 },
});
