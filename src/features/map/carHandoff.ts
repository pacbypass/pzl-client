import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Remove everything the Android Auto car app was handed or kept for this
 * account: the published map and session (`car-map.json`, which carries the
 * saved credentials), the token the car renewed for itself, and its cached
 * book pages and occupancy. Called on sign-out; best effort.
 */
export function clearCarHandoff(): void {
  if (Platform.OS !== 'android') return;
  try {
    for (const entry of new Directory(Paths.document).list()) {
      if (entry instanceof File && /^car-.*\.(json|txt)$/.test(entry.name)) {
        entry.delete();
      }
    }
  } catch {
    // Nothing to clean up, or the directory is unreadable — nothing to do.
  }
}
