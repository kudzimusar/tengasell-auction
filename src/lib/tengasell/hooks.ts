"use client";

// Tengasell shared data hooks — small, predictable fetch wrappers with
// bus-driven refresh (realtime socket events invalidate automatically).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { bus, type BusEvent } from "./bus";
import type { Auction, Category, Notification, Profile, Rating } from "./types";

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  opts?: { events?: BusEvent[] },
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetcherRef.current();
        if (alive) {
          setData(res);
          setLoading(false);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [...deps, nonce]);

  useEffect(() => {
    if (!opts?.events?.length) return;
    const offs = opts.events.map((ev) =>
      bus.on(ev, () => {
        setNonce((n) => n + 1);
      }),
    );
    return () => offs.forEach((off) => off());
  }, [opts?.events?.join(",")]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

let categoryCache: Category[] | null = null;

export function useCategories(): { categories: Category[]; loading: boolean } {
  // Always start "loading" so the FIRST client render matches the SSR
  // skeleton (initializing state from the module cache races lazy-chunk
  // hydration and logged a hydration mismatch when the cache was warm).
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (categoryCache) return categoryCache;
      const cats = await api.categories();
      categoryCache = cats;
      return cats;
    };
    load()
      .then((cats) => {
        if (!alive) return;
        setCategories(cats);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { categories, loading };
}

export function useAuction(id: number) {
  return useResource<Auction | null>(() => api.auction(id), [id], {
    events: ["auction:update", "auction:ended"],
  });
}

export function useProfile(username: string) {
  return useResource<Profile | null>(() => api.profile(username), [username]);
}

export function useRatings(username: string) {
  return useResource<Rating[]>(() => api.ratingsFor(username), [username]);
}

export function useNotifications(enabled: boolean) {
  return useResource<Notification[]>(() => api.notifications(), [enabled], {
    events: ["notification:new"],
  });
}
