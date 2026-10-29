import * as SecureStore from "expo-secure-store";
import {
  createGuardedSessionStorage,
} from "./session-storage-logic";

export { SessionRestorationBlockedError } from "./session-storage-logic";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.tengasell.app.session",
};

const storage = createGuardedSessionStorage({
  read: (key) => SecureStore.getItemAsync(key, OPTIONS),
  write: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
});

export async function secureSessionStorageAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}

export const hasLogoutIntent = storage.hasLogoutIntent;
export const markLogoutIntent = storage.markLogoutIntent;
export const clearLogoutIntent = storage.clearLogoutIntent;
export const readStoredSession = storage.readStoredSession;
export const readCredentialsForLogout = storage.readCredentialsForLogout;
export const writeStoredSession = storage.writeStoredSession;
export const clearStoredSession = storage.clearStoredSession;
