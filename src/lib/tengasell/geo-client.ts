"use client";

// geo-client.ts — browser client for the /api/geo/* BFF endpoints.
// Typed, abort-safe, and total-cost oriented: maps + checkout + tracking
// all funnel through here so the GIS stack stays swappable.

export interface GeoPlace {
  placeId: number;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
}

export interface GeoRoute {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
  estimated: boolean;
  distanceKm?: number;
}

export interface GeoQuote {
  ok: boolean;
  estimated: boolean;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  distanceKm: number;
  durationMinutes: number;
  etaDays: number;
  shipping: "courier" | "nationwide" | "pickup";
  baseFeeUsd: number;
  freeRadiusKm: number;
  perKmUsd: number;
  capUsd: number;
  priceUsd: number;
  path?: [number, number][];
}

async function getJson<T>(url: string, timeoutMs = 4000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function geoAutocomplete(q: string, near?: { lat: number; lng: number }): Promise<GeoPlace[] | null> {
  const qs = new URLSearchParams({ q });
  if (near) {
    qs.set("lat", String(near.lat));
    qs.set("lng", String(near.lng));
  }
  return getJson<{ ok: boolean; results: GeoPlace[] }>(`/api/geo/autocomplete?${qs}`).then(
    (r) => r?.results ?? null,
  );
}

export function geoRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<GeoRoute | null> {
  const qs = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  });
  return getJson<GeoRoute & { ok: boolean }>(`/api/geo/route?${qs}`);
}

export function geoQuote(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  shipping: "courier" | "nationwide" | "pickup",
): Promise<GeoQuote | null> {
  const qs = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    shipping,
  });
  return getJson<GeoQuote>(`/api/geo/quote?${qs}`);
}

/** Interpolate a point at `fraction` (0..1) along a [lng,lat] polyline. */
export function pointAlong(path: [number, number][], fraction: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1 || fraction <= 0) return path[0];
  if (fraction >= 1) return path[path.length - 1];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    segLens.push(len);
    total += len;
  }
  const want = fraction * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= want) {
      const t = segLens[i] === 0 ? 0 : (want - acc) / segLens[i];
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    acc += segLens[i];
  }
  return path[path.length - 1];
}
