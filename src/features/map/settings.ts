import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Map settings persisted locally (AsyncStorage) so the user's chosen background,
 * visible layers, overlays and filters survive restarts and work fully offline.
 */
export type MapSettings = {
  baseLayerKey: string;
  rasterOverlays: Record<string, boolean>;
  showDistricts: boolean;
  showRewirs: boolean;
  showDevices: boolean;
  showStands: boolean;
  showGrounds: boolean;
  /** Only show these district ids (empty = all). */
  filterDistrictIds: string[];
  /** Only show these device type ids (empty = all types). */
  deviceTypeIds: number[];
  camera: { longitude: number; latitude: number; zoom: number } | null;
};

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  baseLayerKey: 'osm',
  rasterOverlays: {},
  showDistricts: true,
  showRewirs: true,
  showDevices: true,
  showStands: false,
  showGrounds: false,
  filterDistrictIds: [],
  deviceTypeIds: [],
  camera: null,
};

const KEY = 'pzl.mapSettings.v1';

export function useMapSettings() {
  const [settings, setSettings] = useState<MapSettings>(DEFAULT_MAP_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      if (raw) {
        try {
          setSettings({ ...DEFAULT_MAP_SETTINGS, ...JSON.parse(raw) });
        } catch {
          /* keep defaults */
        }
      }
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((next: MapSettings) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(next));
    }, 400);
  }, []);

  const update = useCallback(
    (patch: Partial<MapSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggleRasterOverlay = useCallback(
    (key: string) =>
      setSettings((prev) => {
        const next = {
          ...prev,
          rasterOverlays: {
            ...prev.rasterOverlays,
            [key]: !prev.rasterOverlays[key],
          },
        };
        persist(next);
        return next;
      }),
    [persist],
  );

  return { settings, loaded, update, toggleRasterOverlay };
}
