// geo.ts — server-side GIS BFF (backend-for-frontend).
//
// Wraps the Tengasell GIS mini-service (:3004 — Nominatim/Photon/OSRM
// compatible contracts) with:
//   · 2.5s timeouts + AbortController
//   · in-memory TTL caches (geocode 60s, route 300s)
//   · graceful fallbacks (haversine estimate) when the service is down
//   · a delivery-quote domain function (shipping cost + ETA)
//
// Production: point GIS_BASE_URL at the docker-compose stack in infra/gis
// (real Nominatim, Photon, OSRM) — the contracts are identical.

import { ensureGisRunning } from "./geo-spawn";

const BASE = process.env.GIS_BASE_URL ?? "http://localhost:3004";
const TIMEOUT_MS = 2_500;

export interface GeoPlace {
  placeId: number;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  importance?: number;
}

export interface GeoRoute {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][];
  estimated: boolean;
}

export interface DeliveryQuote {
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

// ── tiny TTL cache ──────────────────────────────────────────────────────────

interface CacheEntry<V> {
  value: V;
  expires: number;
}

const caches = {
  geocode: new Map<string, CacheEntry<unknown>>(),
  route: new Map<string, CacheEntry<unknown>>(),
} as const;

function cacheGet<V>(store: Map<string, CacheEntry<unknown>>, key: string): V | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value as V;
}

function cacheSet<V>(store: Map<string, CacheEntry<unknown>>, key: string, value: V, ttlMs: number): void {
  if (store.size > 600) store.clear(); // cheap bounded reset
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// ── fetch helper ────────────────────────────────────────────────────────────

async function gisFetch<T>(path: string): Promise<T | null> {
  try {
    await ensureGisRunning();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── public helpers ──────────────────────────────────────────────────────────

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Forward geocode — Nominatim /search. */
export async function geoSearch(query: string, limit = 5): Promise<GeoPlace[]> {
  const key = `search:${query.toLowerCase()}:${limit}`;
  const cached = cacheGet<GeoPlace[]>(caches.geocode, key);
  if (cached) return cached;
  const raw = await gisFetch<
    {
      place_id: number;
      display_name: string;
      name: string;
      lat: string;
      lon: string;
      type: string;
      importance: number;
    }[]
  >(`/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`);
  const places: GeoPlace[] = (raw ?? []).map((r) => ({
    placeId: r.place_id,
    name: r.name,
    displayName: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    type: r.type,
    importance: r.importance,
  }));
  cacheSet(caches.geocode, key, places, 60_000);
  return places;
}

export interface ReverseGeo {
  displayName: string | null;
  name: string | null;
  address: Record<string, string> | null;
  distanceKm?: number;
}

/** Reverse geocode — Nominatim /reverse. */
export async function geoReverse(lat: number, lng: number): Promise<ReverseGeo> {
  const key = `reverse:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const cached = cacheGet<ReverseGeo>(caches.geocode, key);
  if (cached) return cached;
  const raw = await gisFetch<{
    display_name?: string;
    name?: string;
    address?: Record<string, string>;
    distance_km?: number;
    error?: string;
  }>(`/reverse?lat=${lat}&lon=${lng}&format=json`);
  const out: ReverseGeo = raw && !raw.error
    ? {
        displayName: raw.display_name ?? null,
        name: raw.name ?? null,
        address: raw.address ?? null,
        distanceKm: raw.distance_km,
      }
    : { displayName: null, name: null, address: null };
  cacheSet(caches.geocode, key, out, 60_000);
  return out;
}

/** Autocomplete — Photon /api (GeoJSON FeatureCollection → flat list). */
export async function geoAutocomplete(
  query: string,
  near?: { lat: number; lng: number },
  limit = 6,
): Promise<GeoPlace[]> {
  const key = `auto:${query.toLowerCase()}:${near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : "-"}:${limit}`;
  const cached = cacheGet<GeoPlace[]>(caches.geocode, key);
  if (cached) return cached;
  const qs = `q=${encodeURIComponent(query)}&limit=${limit}` +
    (near ? `&lat=${near.lat}&lon=${near.lng}` : "");
  const raw = await gisFetch<{
    features: {
      geometry: { coordinates: [number, number] };
      properties: { osm_id: number; name: string; city?: string; state?: string; type: string };
    }[];
  }>(`/api?${qs}`);
  const places: GeoPlace[] = (raw?.features ?? []).map((f) => ({
    placeId: f.properties.osm_id,
    name: f.properties.name,
    displayName: [f.properties.name, f.properties.city, "Zimbabwe"].filter(Boolean).join(", "),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    type: f.properties.type,
  }));
  cacheSet(caches.geocode, key, places, 60_000);
  return places;
}

/** Driving route — OSRM /route/v1/driving. Falls back to haversine × 1.35. */
export async function geoRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<GeoRoute> {
  const key = `route:${from.lat.toFixed(4)},${from.lng.toFixed(4)};${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const cached = cacheGet<GeoRoute>(caches.route, key);
  if (cached) return cached;

  const raw = await gisFetch<{
    routes: {
      distance: number;
      duration: number;
      geometry: { type: string; coordinates: [number, number][] | string };
    }[];
  }>(
    `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
  );

  let out: GeoRoute;
  if (raw?.routes?.[0] && Array.isArray(raw.routes[0].geometry.coordinates)) {
    out = {
      distanceMeters: raw.routes[0].distance,
      durationSeconds: raw.routes[0].duration,
      coordinates: raw.routes[0].geometry.coordinates as [number, number][],
      estimated: false,
    };
  } else {
    // Fallback: straight-line × road detour factor, 65 km/h average.
    const km = haversineKm(from, to) * 1.35;
    out = {
      distanceMeters: Math.round(km * 1000),
      durationSeconds: Math.round((km / 65) * 3600),
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      estimated: true,
    };
  }
  cacheSet(caches.route, key, out, 300_000);
  return out;
}

// ── delivery quote (domain logic) ───────────────────────────────────────────

const SHIPPING_RATES: Record<DeliveryQuote["shipping"], { base: number; cap: number }> = {
  courier: { base: 4, cap: 60 },
  nationwide: { base: 2, cap: 45 },
  pickup: { base: 0, cap: 0 },
};
const FREE_RADIUS_KM = 25;
const PER_KM_USD = 0.02;

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Quote a delivery from an origin point (usually the seller's city centre)
 * to a destination point (the buyer's geocoded address).
 *   courier:    US$4 base, US$0.02/km beyond 25 km, capped US$60
 *   nationwide: US$2 base, same per-km, capped US$45
 *   pickup:     free — buyer collects
 * ETA days: 1 + km/350 (road distance), min 1.
 */
export async function geoDeliveryQuote(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  shipping: DeliveryQuote["shipping"];
}): Promise<DeliveryQuote> {
  const { origin, destination, shipping } = params;
  if (shipping === "pickup") {
    return {
      ok: true,
      estimated: false,
      origin,
      destination,
      distanceKm: 0,
      durationMinutes: 0,
      etaDays: 0,
      shipping,
      baseFeeUsd: 0,
      freeRadiusKm: FREE_RADIUS_KM,
      perKmUsd: 0,
      capUsd: 0,
      priceUsd: 0,
    };
  }
  const route = await geoRoute(origin, destination);
  const km = route.distanceMeters / 1000;
  const rates = SHIPPING_RATES[shipping];
  const billableKm = Math.max(0, km - FREE_RADIUS_KM);
  const price = Math.min(rates.base + billableKm * PER_KM_USD, rates.cap);
  return {
    ok: true,
    estimated: route.estimated,
    origin,
    destination,
    distanceKm: Math.round(km * 10) / 10,
    durationMinutes: Math.round(route.durationSeconds / 60),
    etaDays: Math.max(1, 1 + Math.floor(km / 350)),
    shipping,
    baseFeeUsd: rates.base,
    freeRadiusKm: FREE_RADIUS_KM,
    perKmUsd: PER_KM_USD,
    capUsd: rates.cap,
    priceUsd: roundUsd(price),
    path: route.coordinates,
  };
}
