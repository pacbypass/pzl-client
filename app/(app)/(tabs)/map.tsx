import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
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
import { BASE_LAYERS, OVERLAY_LAYERS, POLAND_CENTER } from '@/map/layers';
import { buildMapStyle, type VectorOverlay } from '@/map/style';
import { DataAge } from '@/components/offline';
import { useMapSettings } from '@/features/map/settings';
import {
  useDevicesGeo,
  useDistrictsGeo,
  useGroundsGeo,
  useStandsGeo,
  type FeatureCollection,
} from '@/features/map/geo';
import { useHuntingDistrictOptions } from '@/features/huntingBook/lookups';
import {
  downloadOfflineArea,
  OFFLINE_DOWNLOAD_SUPPORTED,
} from '@/features/map/offline';
import { useUnits } from '@/units/UnitProvider';

const DISTRICT_COLOR = '#2f6b26';
const GROUNDS_COLOR = '#8d6e63';
const DEVICE_COLOR = '#f57c00';
const STAND_COLOR = '#1976d2';
const ID_KEYS = ['id', 'huntingDistrictId', 'number', 'districtId'];

/** Keep only features whose id property is in the selected set (empty = all). */
function filterFeatures(fc: FeatureCollection | undefined, ids: string[]): FeatureCollection {
  if (!fc) return { type: 'FeatureCollection', features: [] };
  if (ids.length === 0) return fc;
  const set = new Set(ids);
  const features = fc.features.filter((f) => {
    const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
    return ID_KEYS.some((k) => props[k] != null && set.has(String(props[k])));
  });
  return { type: 'FeatureCollection', features };
}

export default function MapScreen() {
  const theme = useTheme();
  const { activeUnitId } = useUnits();
  const unitId = activeUnitId ?? '';
  const { settings, loaded, update, toggleRasterOverlay } = useMapSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const districts = useDistrictsGeo(unitId, settings.showDistricts);
  const grounds = useGroundsGeo(unitId, settings.showGrounds);
  const devices = useDevicesGeo(unitId, settings.showDevices);
  const stands = useStandsGeo(unitId, settings.showStands);
  const districtOptions = useHuntingDistrictOptions(unitId);

  const activeRasterKeys = useMemo(() => {
    const keys = new Set<string>([settings.baseLayerKey]);
    for (const l of OVERLAY_LAYERS) {
      if (settings.rasterOverlays[l.key]) keys.add(l.key);
    }
    return keys;
  }, [settings.baseLayerKey, settings.rasterOverlays]);

  const vectorOverlays = useMemo<VectorOverlay[]>(() => {
    const out: VectorOverlay[] = [];
    if (settings.showGrounds && grounds.data) {
      out.push({ key: 'grounds', kind: 'polygon', data: grounds.data, color: GROUNDS_COLOR });
    }
    if (settings.showDistricts && districts.data) {
      out.push({
        key: 'districts',
        kind: 'polygon',
        data: filterFeatures(districts.data, settings.filterDistrictIds),
        color: DISTRICT_COLOR,
        labelKeys: ['number', 'huntingDistrictNumber', 'name'],
      });
    }
    if (settings.showDevices && devices.data) {
      out.push({ key: 'devices', kind: 'point', data: devices.data, color: DEVICE_COLOR });
    }
    if (settings.showStands && stands.data) {
      out.push({ key: 'stands', kind: 'point', data: stands.data, color: STAND_COLOR });
    }
    return out;
  }, [settings, districts.data, grounds.data, devices.data, stands.data]);

  const onDownloadOffline = async () => {
    const cam = settings.camera ?? POLAND_CENTER;
    const half = 360 / Math.pow(2, cam.zoom); // ~viewport half-span in degrees
    const bounds: [[number, number], [number, number]] = [
      [cam.longitude + half, cam.latitude + half],
      [cam.longitude - half, cam.latitude - half],
    ];
    setDownloading(true);
    try {
      const style = buildMapStyle(activeRasterKeys, []);
      const res = await downloadOfflineArea(
        style,
        bounds,
        `pzl-${Math.round(cam.longitude * 1000)}-${Math.round(cam.latitude * 1000)}`,
        Math.max(6, Math.floor(cam.zoom) - 1),
        Math.min(16, Math.floor(cam.zoom) + 3),
      );
      setSnack(res.message);
    } finally {
      setDownloading(false);
    }
  };

  if (!loaded) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <HuntingMap
        activeRasterKeys={activeRasterKeys}
        vectorOverlays={vectorOverlays}
        initialCamera={settings.camera}
        onCameraChange={(camera) => update({ camera })}
      />

      <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
        <Surface style={styles.ageChip} elevation={2}>
          <DataAge
            updatedAt={districts.dataUpdatedAt || devices.dataUpdatedAt}
            isFetching={districts.isFetching || devices.isFetching}
          />
        </Surface>
        <IconButton
          icon="layers"
          mode="contained"
          size={24}
          onPress={() => setPanelOpen((o) => !o)}
          style={styles.fab}
        />
      </SafeAreaView>

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
                  PODKŁAD (zapisywany lokalnie)
                </Text>
                <RadioButton.Group
                  value={settings.baseLayerKey}
                  onValueChange={(v) => update({ baseLayerKey: v })}
                >
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
                  DANE KOŁA (offline)
                </Text>
                <Checkbox.Item
                  label="Obwody / rewiry"
                  status={settings.showDistricts ? 'checked' : 'unchecked'}
                  onPress={() => update({ showDistricts: !settings.showDistricts })}
                />
                <Checkbox.Item
                  label="Dzierżawy / działki"
                  status={settings.showGrounds ? 'checked' : 'unchecked'}
                  onPress={() => update({ showGrounds: !settings.showGrounds })}
                />
                <Checkbox.Item
                  label="Urządzenia łowieckie"
                  status={settings.showDevices ? 'checked' : 'unchecked'}
                  onPress={() => update({ showDevices: !settings.showDevices })}
                />
                <Checkbox.Item
                  label="Ambony / stanowiska"
                  status={settings.showStands ? 'checked' : 'unchecked'}
                  onPress={() => update({ showStands: !settings.showStands })}
                />

                {settings.showDistricts && (districtOptions.data?.length ?? 0) > 0 ? (
                  <List.Accordion
                    title="Filtr obwodów (zapisywany)"
                    id="district-filter"
                  >
                    {(districtOptions.data ?? []).map((o) => {
                      const checked = settings.filterDistrictIds.includes(o.id);
                      return (
                        <Checkbox.Item
                          key={o.id}
                          label={o.label}
                          status={checked ? 'checked' : 'unchecked'}
                          onPress={() =>
                            update({
                              filterDistrictIds: checked
                                ? settings.filterDistrictIds.filter((x) => x !== o.id)
                                : [...settings.filterDistrictIds, o.id],
                            })
                          }
                        />
                      );
                    })}
                    {settings.filterDistrictIds.length > 0 ? (
                      <Button onPress={() => update({ filterDistrictIds: [] })}>
                        Pokaż wszystkie
                      </Button>
                    ) : null}
                  </List.Accordion>
                ) : null}

                <Divider style={styles.mt} />
                <Button
                  mode="contained-tonal"
                  icon="download"
                  loading={downloading}
                  disabled={downloading}
                  onPress={onDownloadOffline}
                  style={styles.mt}
                >
                  {OFFLINE_DOWNLOAD_SUPPORTED
                    ? 'Zapisz obszar offline'
                    : 'Mapa offline (info)'}
                </Button>
              </ScrollView>
            </Surface>
          </SafeAreaView>
        </Portal>
      ) : null}

      <Snackbar visible={!!snack} onDismiss={() => setSnack(null)} duration={4000}>
        {snack ?? ''}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  ageChip: {
    margin: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  fab: { margin: 8 },
  panelWrap: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    margin: 12,
    borderRadius: 16,
    paddingHorizontal: 4,
    paddingBottom: 12,
    maxHeight: '80%',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
  },
  section: { marginTop: 8, marginBottom: 2, marginLeft: 16, opacity: 0.6 },
  bold: { fontWeight: '700' },
  mt: { marginTop: 8, marginHorizontal: 12 },
});
