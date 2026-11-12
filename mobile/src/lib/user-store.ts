// TENGASELL — User store instance wired to Expo SecureStore with graceful fallback.

import * as SecureStore from "expo-secure-store";
import {
  createInMemoryStorage,
  createUserStore,
  type StorageAdapter,
} from "./user-store-logic.ts";

export {
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from "./user-store-logic.ts";

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.tengasell.app.userstore",
};

let fallbackStorage: StorageAdapter | null = null;

const secureAdapter: StorageAdapter = {
  read: async (key: string) => {
    try {
      const avail = await SecureStore.isAvailableAsync();
      if (!avail) {
        if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
        return fallbackStorage.read(key);
      }
      return await SecureStore.getItemAsync(key, STORE_OPTIONS);
    } catch {
      if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
      return fallbackStorage.read(key);
    }
  },
  write: async (key: string, value: string) => {
    try {
      const avail = await SecureStore.isAvailableAsync();
      if (!avail) {
        if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
        await fallbackStorage.write(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value, STORE_OPTIONS);
    } catch {
      if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
      await fallbackStorage.write(key, value);
    }
  },
  remove: async (key: string) => {
    try {
      const avail = await SecureStore.isAvailableAsync();
      if (!avail) {
        if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
        await fallbackStorage.remove(key);
        return;
      }
      await SecureStore.deleteItemAsync(key, STORE_OPTIONS);
    } catch {
      if (!fallbackStorage) fallbackStorage = createInMemoryStorage();
      await fallbackStorage.remove(key);
    }
  },
};

const store = createUserStore(secureAdapter);

export const getSearchHistory = store.getSearchHistory;
export const addSearchQuery = store.addSearchQuery;
export const removeSearchQuery = store.removeSearchQuery;
export const clearSearchHistory = store.clearSearchHistory;
export const getRecentlyViewed = store.getRecentlyViewed;
export const recordViewedItem = store.recordViewedItem;
export const clearRecentlyViewed = store.clearRecentlyViewed;
export const getUserPreferences = store.getUserPreferences;
export const setUserPreferences = store.setUserPreferences;
