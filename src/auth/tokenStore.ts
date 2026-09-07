import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Token persistence. Uses expo-secure-store on native (Keychain / Keystore),
 * falls back to localStorage on web where SecureStore is unavailable.
 */
export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number; // epoch ms
  /** Client the token was issued for — used to refresh a token-bridge session. */
  clientId?: string;
};

const KEY = 'pzl.tokens';

const webStore = {
  getItem: async (k: string) =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null,
  setItem: async (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  removeItem: async (k: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

const store =
  Platform.OS === 'web'
    ? webStore
    : {
        getItem: (k: string) => SecureStore.getItemAsync(k),
        setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
        removeItem: (k: string) => SecureStore.deleteItemAsync(k),
      };

export async function loadTokens(): Promise<TokenSet | null> {
  const raw = await store.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

// --- saved credentials (opt-in "keep me signed in") ---
const CRED_KEY = 'pzl.credentials';

export type Credentials = { username: string; password: string; helpdesccode?: string };

export async function saveCredentials(creds: Credentials): Promise<void> {
  await store.setItem(CRED_KEY, JSON.stringify(creds));
}

export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await store.getItem(CRED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await store.removeItem(CRED_KEY);
}

export async function saveTokens(tokens: TokenSet): Promise<void> {
  await store.setItem(KEY, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
  await store.removeItem(KEY);
}
