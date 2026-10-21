"use client";

// Tengasell Location & Maps — explicit-use-only geolocation.
// NEVER auto-requests: geolocation is invoked solely from user actions
// ("Use my location" / "Near me"). On success we resolve the nearest
// marketplace city and persist it to localStorage (ts_geo_city) so later
// visits can restore it without another permission round-trip.

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/tengasell/i18n";
import { cityInfo, nearestCity, type CityInfo } from "./cities";

const STORAGE_KEY = "ts_geo_city";

export type GeoErrorCode = "denied" | "unavailable" | "unsupported";

/** Geolocation failure with a machine-readable code — message is localized
 *  at display time via geoErrorMessage(). */
export class GeoError extends Error {
  code: GeoErrorCode;
  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = "GeoError";
    this.code = code;
  }
}

/** Friendly localized message for a geolocation failure code. */
export function geoErrorMessage(code: GeoErrorCode, t: (k: string) => string): string {
  switch (code) {
    case "denied":
      return t("location.geoDenied");
    case "unsupported":
      return t("location.geoUnsupported");
    default:
      return t("location.geoUnavailable");
  }
}

/** Persisted nearest city (validated), or null when never requested. */
export function readSavedGeoCity(): string | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved && cityInfo(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Explicit user action only. Resolves the nearest Zimbabwe city for the
 *  current browser position and persists it (ts_geo_city). Rejects with a
 *  GeoError carrying a localized-friendly code. */
export async function requestLocation(opts?: { timeoutMs?: number }): Promise<CityInfo> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeoError("unsupported", "Geolocation API unavailable");
  }
  return new Promise<CityInfo>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const near = nearestCity(pos.coords.latitude, pos.coords.longitude);
        try {
          window.localStorage.setItem(STORAGE_KEY, near.name);
        } catch {
          /* storage unavailable — the session value still works */
        }
        resolve(near);
      },
      (err) => {
        const code: GeoErrorCode = err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
        reject(new GeoError(code, err.message));
      },
      { enableHighAccuracy: false, timeout: opts?.timeoutMs ?? 10_000, maximumAge: 600_000 },
    );
  });
}

export interface GeoCityState {
  /** Nearest city name (persisted across visits), or null until known. */
  city: string | null;
  requesting: boolean;
  /** Friendly localized error message from the last request, or null. */
  error: string | null;
  /** Trigger a geolocation request — call from a user event handler only. */
  request: () => void;
}

export function useGeoCity(): GeoCityState {
  const { t } = useI18n();
  const [city, setCity] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the persisted city after hydration (deferred a tick — the same
  // pattern used for ts_seen_threads, keeps the mount effect side-effect
  // free of immediate setState).
  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = readSavedGeoCity();
      if (saved) setCity((cur) => cur ?? saved);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const request = useCallback(() => {
    setRequesting(true);
    setError(null);
    requestLocation()
      .then((near) => {
        setCity(near.name);
        setRequesting(false);
      })
      .catch((err: unknown) => {
        const code: GeoErrorCode = err instanceof GeoError ? err.code : "unavailable";
        setError(geoErrorMessage(code, t));
        setRequesting(false);
      });
  }, [t]);

  return { city, requesting, request, error };
}
