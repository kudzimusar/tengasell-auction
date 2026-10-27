import * as SecureStore from "expo-secure-store";

import type { TrailBaseTokens } from "../lib/trailbase";

const AUTH_TOKEN_KEY = "tengasell.session.auth_token";
const REFRESH_TOKEN_KEY = "tengasell.session.refresh_token";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.tengasell.app.session",
};

export async function secureSessionStorageAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}

export async function readStoredSession(): Promise<TrailBaseTokens | null> {
  const [authToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(AUTH_TOKEN_KEY, OPTIONS),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
  ]);

  if (!authToken && !refreshToken) return null;
  if (!authToken || !refreshToken) {
    await clearStoredSession();
    return null;
  }
  return { authToken, refreshToken };
}

export async function writeStoredSession(tokens: TrailBaseTokens): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(AUTH_TOKEN_KEY, tokens.authToken, OPTIONS),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, OPTIONS),
    ]);
  } catch (error) {
    await clearStoredSession();
    throw error;
  }
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(AUTH_TOKEN_KEY, OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
  ]);
}
