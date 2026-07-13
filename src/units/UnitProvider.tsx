import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { endpoints } from '@/api/endpoints';

/** A hunting-club unit (koło łowieckie / OHZ / zarząd okręgowy). */
export type Unit = {
  id: string;
  name: string;
  type?: string;
  number?: string;
};

type UnitState = {
  units: Unit[];
  activeUnitId: string | null;
  activeUnit: Unit | null;
  setActiveUnitId: (id: string) => void;
  isLoading: boolean;
  error: unknown;
};

const UnitContext = createContext<UnitState | null>(null);
const STORAGE_KEY = 'pzl.activeUnitId';

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [activeUnitId, setActiveUnitIdState] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['units'],
    // `/units` requires a `unit-types` enum (KL = koło łowieckie, ZO, OHZ) and
    // returns `{ value, label }` picker rows (confirmed against the live API).
    queryFn: () =>
      apiRequest<Array<Record<string, unknown>>>(endpoints.units, {
        query: { 'unit-types': 'KL' },
      }),
  });

  const units = useMemo<Unit[]>(
    () =>
      (data ?? []).map((u) => ({
        id: String(u.value ?? u.id),
        name: String(u.label ?? u.name ?? u.value ?? u.id),
        type: u.type as string | undefined,
        number: u.number as string | undefined,
      })),
    [data],
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved) setActiveUnitIdState(saved);
    });
  }, []);

  // Default to the first unit once the list loads and nothing is selected.
  useEffect(() => {
    if (!activeUnitId && units.length > 0) {
      setActiveUnitIdState(units[0].id);
    }
  }, [activeUnitId, units]);

  const setActiveUnitId = (id: string) => {
    setActiveUnitIdState(id);
    AsyncStorage.setItem(STORAGE_KEY, id);
  };

  const value: UnitState = {
    units,
    activeUnitId,
    activeUnit: units.find((u) => u.id === activeUnitId) ?? null,
    setActiveUnitId,
    isLoading,
    error,
  };

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnits(): UnitState {
  const ctx = useContext(UnitContext);
  if (!ctx) throw new Error('useUnits must be used within <UnitProvider>');
  return ctx;
}

/** Convenience: throws if no unit is selected (module screens require one). */
export function useActiveUnitId(): string {
  const { activeUnitId } = useUnits();
  if (!activeUnitId) throw new Error('No active unit selected');
  return activeUnitId;
}
