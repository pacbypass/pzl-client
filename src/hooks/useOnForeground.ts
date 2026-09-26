import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Run `onForeground` whenever the app comes back to the foreground — the case
 * `useFocusEffect` misses: a tab screen that stays focused while the phone is
 * pocketed never "refocuses", so without this its data is as old as the last
 * time the user switched tabs.
 */
export function useOnForeground(onForeground: () => void) {
  const callback = useRef(onForeground);
  callback.current = onForeground;
  useEffect(() => {
    let previous = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') callback.current();
      previous = next;
    });
    return () => sub.remove();
  }, []);
}
