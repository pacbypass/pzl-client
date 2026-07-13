import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/**
 * Bridges NetInfo into React Query's onlineManager so queries/mutations pause
 * while offline and auto-resume on reconnect. Call once at startup.
 */
export function initOnlineManager() {
  onlineManager.setEventListener((setOnline) => {
    return NetInfo.addEventListener((state) => {
      const online =
        state.isConnected != null
          ? Boolean(state.isConnected && (state.isInternetReachable ?? true))
          : true;
      setOnline(online);
    });
  });
}

/** Reactive connectivity for UI (banners, sync indicators). */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => {
    // onlineManager is the single source of truth once initOnlineManager ran.
    return onlineManager.subscribe(() => setOnline(onlineManager.isOnline()));
  }, []);
  // Web fires reliable navigator.onLine; native relies on the NetInfo bridge.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const on = () => onlineManager.setOnline(true);
    const off = () => onlineManager.setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
