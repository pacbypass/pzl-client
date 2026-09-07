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
import { config } from '@/config';
import { useAuth } from '@/auth/AuthProvider';

/** A hunting-club unit (koło łowieckie / OHZ / zarząd okręgowy). */
export type Unit = {
  id: string;
  name: string;
  type?: string;
  number?: string;
  roles?: string[];
};

/** Shape of the OIDC /userinfo response (the source of the user's own clubs). */
type UserInfo = {
  username?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  units?: Array<{
    id: number | string;
    name?: string;
    type?: string;
    typeName?: string;
    roles?: Array<{ name?: string; systemId?: string }>;
  }>;
};

export type CurrentUser = {
  fullName: string;
  email?: string;
  username?: string;
};

type UnitState = {
  units: Unit[];
  user: CurrentUser | null;
  activeUnitId: string | null;
  activeUnit: Unit | null;
  setActiveUnitId: (id: string) => void;
  isLoading: boolean;
  error: unknown;
};

const UnitContext = createContext<UnitState | null>(null);
const STORAGE_KEY = 'pzl.activeUnitId';

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [activeUnitId, setActiveUnitIdState] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['userinfo-units'],
    // Only after login — before that there's no token and /userinfo returns 401.
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 60,
    // The user's OWN clubs come from the OIDC /userinfo endpoint (on the auth
    // server) — NOT /units, which is a global picker of all ~3000 clubs.
    queryFn: () =>
      apiRequest<UserInfo>('/userinfo', { baseUrl: config.authIssuer }),
  });

  const units = useMemo<Unit[]>(
    () =>
      (data?.units ?? []).map((u) => ({
        id: String(u.id),
        name: u.name ?? String(u.id),
        type: u.typeName ?? u.type,
        roles: u.roles?.map((r) => r.name ?? r.systemId ?? '').filter(Boolean),
      })),
    [data],
  );

  const user = useMemo<CurrentUser | null>(() => {
    if (!data) return null;
    const fullName = [data.firstname, data.lastname].filter(Boolean).join(' ').trim();
    return {
      fullName: fullName || data.username || 'Myśliwy',
      email: data.email,
      username: data.username,
    };
  }, [data]);

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
    user,
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
