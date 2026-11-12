// TENGASELL — User store logic for search history, recently viewed listings,
// and user-controlled personalization preferences.
// Pure business logic with pluggable storage adapter.

import type { AuctionView } from "./types.ts";

export interface StorageAdapter {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface UserPreferences {
  personalizationEnabled: boolean;
  historyEnabled: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  personalizationEnabled: true,
  historyEnabled: true,
};

export function createUserStore(storage: StorageAdapter) {
  const memSearchHistory = new Map<string, string[]>();
  const memRecentlyViewed = new Map<string, AuctionView[]>();
  let memPreferences: UserPreferences = { ...DEFAULT_PREFERENCES };

  function getScopeKey(userId?: string | null): string {
    if (!userId || userId.trim() === "") return "anon";
    return `usr_${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  const MAX_HISTORY = 15;
  const MAX_VIEWED = 20;

  async function getSearchHistory(userId?: string | null): Promise<string[]> {
    const scope = getScopeKey(userId);
    if (memSearchHistory.has(scope)) {
      return [...(memSearchHistory.get(scope) || [])];
    }
    try {
      const raw = await storage.read(`search_hist_${scope}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
          memSearchHistory.set(scope, filtered);
          return [...filtered];
        }
      }
    } catch {
      // Ignore
    }
    memSearchHistory.set(scope, []);
    return [];
  }

  async function addSearchQuery(query: string, userId?: string | null): Promise<string[]> {
    const trimmed = query.trim();
    if (!trimmed) return getSearchHistory(userId);
    const scope = getScopeKey(userId);
    const current = await getSearchHistory(userId);
    const next = [trimmed, ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(
      0,
      MAX_HISTORY,
    );
    memSearchHistory.set(scope, next);
    try {
      await storage.write(`search_hist_${scope}`, JSON.stringify(next));
    } catch {
      // Ignore
    }
    return [...next];
  }

  async function removeSearchQuery(query: string, userId?: string | null): Promise<string[]> {
    const scope = getScopeKey(userId);
    const current = await getSearchHistory(userId);
    const next = current.filter((item) => item.toLowerCase() !== query.trim().toLowerCase());
    memSearchHistory.set(scope, next);
    try {
      await storage.write(`search_hist_${scope}`, JSON.stringify(next));
    } catch {
      // Ignore
    }
    return [...next];
  }

  async function clearSearchHistory(userId?: string | null): Promise<void> {
    const scope = getScopeKey(userId);
    memSearchHistory.set(scope, []);
    try {
      await storage.remove(`search_hist_${scope}`);
    } catch {
      // Ignore
    }
  }

  async function getRecentlyViewed(userId?: string | null): Promise<AuctionView[]> {
    const scope = getScopeKey(userId);
    if (memRecentlyViewed.has(scope)) {
      return [...(memRecentlyViewed.get(scope) || [])];
    }
    try {
      const raw = await storage.read(`viewed_items_${scope}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          memRecentlyViewed.set(scope, parsed);
          return [...parsed];
        }
      }
    } catch {
      // Ignore
    }
    memRecentlyViewed.set(scope, []);
    return [];
  }

  async function recordViewedItem(item: AuctionView, userId?: string | null): Promise<void> {
    if (!item || !item.id) return;
    const prefs = await getUserPreferences();
    if (!prefs.historyEnabled) return;

    const scope = getScopeKey(userId);
    const current = await getRecentlyViewed(userId);
    const next = [item, ...current.filter((it) => it.id !== item.id)].slice(0, MAX_VIEWED);
    memRecentlyViewed.set(scope, next);
    try {
      await storage.write(`viewed_items_${scope}`, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }

  async function clearRecentlyViewed(userId?: string | null): Promise<void> {
    const scope = getScopeKey(userId);
    memRecentlyViewed.set(scope, []);
    try {
      await storage.remove(`viewed_items_${scope}`);
    } catch {
      // Ignore
    }
  }

  async function getUserPreferences(): Promise<UserPreferences> {
    try {
      const raw = await storage.read("user_preferences");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          memPreferences = {
            personalizationEnabled:
              typeof parsed.personalizationEnabled === "boolean"
                ? parsed.personalizationEnabled
                : DEFAULT_PREFERENCES.personalizationEnabled,
            historyEnabled:
              typeof parsed.historyEnabled === "boolean"
                ? parsed.historyEnabled
                : DEFAULT_PREFERENCES.historyEnabled,
          };
          return { ...memPreferences };
        }
      }
    } catch {
      // Ignore
    }
    return { ...memPreferences };
  }

  async function setUserPreferences(updates: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await getUserPreferences();
    const next: UserPreferences = {
      ...current,
      ...updates,
    };
    memPreferences = next;
    try {
      await storage.write("user_preferences", JSON.stringify(next));
    } catch {
      // Ignore
    }
    return { ...next };
  }

  return {
    getSearchHistory,
    addSearchQuery,
    removeSearchQuery,
    clearSearchHistory,
    getRecentlyViewed,
    recordViewedItem,
    clearRecentlyViewed,
    getUserPreferences,
    setUserPreferences,
  };
}

export function createInMemoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    read: async (key: string) => map.get(key) ?? null,
    write: async (key: string, value: string) => {
      map.set(key, value);
    },
    remove: async (key: string) => {
      map.delete(key);
    },
  };
}
