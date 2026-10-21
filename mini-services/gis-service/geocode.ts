// geocode.ts — Nominatim-compatible /search + /reverse and Photon-compatible
// /api autocomplete over the curated gazetteer.
//
// Matching strategy (case-insensitive, token-based, "Levenshtein-lite"):
//   full-name equality > full-name prefix > token equality > token prefix >
//   token substring > name substring > parent/province match > fuzzy
//   (edit-distance ≤ 1 on tokens ≥ 4 chars, or subsequence). Ranked together
//   with `importance` and — for Photon — a proximity boost around lat/lon.

import {
  GAZETTEER,
  GazetteerEntry,
  haversineKm,
  parentName,
  nearestWithin,
} from "./gazetteer";
import { geocodeCache } from "./cache";

const LICENCE =
  "Data © OpenStreetMap contributors, ODbL 1.0 — Tengasell curated gazetteer (https://osm.org/copyright)";

/** Split into lowercase alphanumeric tokens. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** True when edit distance between a and b is ≤ 1 (cheap early exits). */
function withinEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la === lb) {
      i++;
      j++;
    } else if (la > lb) i++;
    else j++;
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Is `t` a subsequence of `word` (fuzzy-lite)? */
function isSubsequence(t: string, word: string): boolean {
  if (t.length < 3 || t.length >= word.length) return false;
  let i = 0;
  for (const ch of word) {
    if (ch === t[i]) i++;
    if (i === t.length) return true;
  }
  return i === t.length;
}

/** Score a single query token against an entry; 0 = no match. */
function tokenScore(entry: GazetteerEntry, token: string): number {
  const nameLower = entry.name.toLowerCase();
  const nameTokens = tokenize(entry.name);
  if (nameLower === token) return 4;
  if (nameLower.startsWith(token)) return 3.5;
  let best = 0;
  for (const nt of nameTokens) {
    if (nt === token) best = Math.max(best, 3.5);
    else if (nt.startsWith(token)) best = Math.max(best, 3);
    else if (nt.includes(token)) best = Math.max(best, 2);
  }
  if (best > 0) return best;
  if (nameLower.includes(token)) return 1.8;

  // Parent chain / province context ("avondale harare").
  const parent = entry.parent ? parentName(entry) : null;
  if (parent) {
    const parentLower = parent.toLowerCase();
    if (parentLower === token) return 1.5;
    if (parentLower.startsWith(token) || token.startsWith(parentLower)) return 1.4;
    if (tokenize(parent).some((pt) => pt.startsWith(token))) return 1.4;
  }
  if (entry.province && entry.province.toLowerCase().includes(token)) return 1.2;

  // "zimbabwe" itself matches everything loosely.
  if ("zimbabwe".startsWith(token) || token === "zw") return 1;

  // Fuzzy-lite: near-miss tokens ("brrw" → "borrow" handled by subsequence).
  for (const nt of nameTokens) {
    if (nt.length >= 4 && token.length >= 3 && withinEditDistance1(nt, token)) return 1;
    if (isSubsequence(token, nt)) return 0.8;
  }
  return 0;
}

/** All tokens must match something; returns combined score or null. */
function scoreEntry(entry: GazetteerEntry, tokens: string[]): number | null {
  let sum = 0;
  for (const token of tokens) {
    const s = tokenScore(entry, token);
    if (s <= 0) return null;
    sum += s;
  }
  return sum;
}

/** OSM-style key/value classification for Photon output. */
function osmClassification(entry: GazetteerEntry): {
  osm_key: string;
  osm_value: string;
} {
  switch (entry.type) {
    case "city":
      return { osm_key: "place", osm_value: "city" };
    case "suburb":
      return { osm_key: "place", osm_value: "suburb" };
    case "town":
      return { osm_key: "place", osm_value: "town" };
    case "district":
      return { osm_key: "boundary", osm_value: "administrative" };
    case "airport":
      return { osm_key: "aeroway", osm_value: "aerodrome" };
    case "landmark":
      return { osm_key: "place", osm_value: "locality" };
    default:
      return { osm_key: "place", osm_value: "locality" };
  }
}

interface Scored {
  entry: GazetteerEntry;
  score: number;
}

function scoredMatches(query: string): Scored[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const out: Scored[] = [];
  for (const entry of GAZETTEER) {
    const s = scoreEntry(entry, tokens);
    if (s === null) continue;
    out.push({ entry, score: s + entry.importance * 1.5 });
  }
  out.sort((a, b) => b.score - a.score || b.entry.importance - a.entry.importance);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /search?q={address}&format=json&limit=5  (Nominatim-compatible array)
// ─────────────────────────────────────────────────────────────────────────────

export interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_class: string;
  type: string;
  display_name: string;
  name: string;
  parent: string | null;
  lat: string;
  lon: string;
  importance: number;
  boundingbox: [string, string, string, string];
}

export function searchNominatim(query: string, limit = 5): NominatimResult[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  const cappedLimit = Math.min(Math.max(1, limit), 50);
  const cacheKey = `search:${q.toLowerCase()}:${cappedLimit}`;
  const cached = geocodeCache.get(cacheKey) as NominatimResult[] | undefined;
  if (cached) return cached;

  const results = scoredMatches(q)
    .slice(0, cappedLimit)
    .map(({ entry }) => ({
      place_id: entry.placeId,
      licence: LICENCE,
      osm_type: "node",
      osm_class: "place",
      type: entry.type,
      display_name: entry.displayName,
      name: entry.name,
      parent: parentName(entry),
      lat: entry.lat.toFixed(7),
      lon: entry.lng.toFixed(7),
      importance: entry.importance,
      boundingbox: [
        String(entry.bbox[0]),
        String(entry.bbox[2]),
        String(entry.bbox[1]),
        String(entry.bbox[3]),
      ] as [string, string, string, string],
    }));

  geocodeCache.set(cacheKey, results);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /reverse?lat={lat}&lon={lon}&format=json&zoom=  (Nominatim-compatible)
// ─────────────────────────────────────────────────────────────────────────────

export interface NominatimReverseResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_class: string;
  type: string;
  display_name: string;
  name: string;
  lat: string;
  lon: string;
  importance: number;
  address: Record<string, string>;
  boundingbox: [string, string, string, string];
  distance_km?: number;
}

export interface ReverseOutcome {
  status: number;
  body: NominatimReverseResult | { error: string };
}

export function reverseNominatim(
  lat: number,
  lng: number,
  zoom?: number,
): ReverseOutcome {
  const cacheKey = `reverse:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const cached = geocodeCache.get(cacheKey) as ReverseOutcome | undefined;
  if (cached) return cached;

  const hit = nearestWithin(lat, lng, 25);
  if (!hit) {
    const outcome: ReverseOutcome = { status: 200, body: { error: "Unable to geocode" } };
    geocodeCache.set(cacheKey, outcome);
    return outcome;
  }
  const { entry, distanceKm } = hit;
  const address: Record<string, string> = { country: "Zimbabwe", country_code: "zw" };
  const parent = entry.parent ? parentName(entry) : null;
  switch (entry.type) {
    case "suburb":
      if (parent) address.city = parent;
      address.suburb = entry.name;
      break;
    case "city":
      address.city = entry.name;
      break;
    case "town":
      address.town = entry.name;
      break;
    case "district":
      address.district = entry.name;
      break;
    case "airport":
      if (parent) address.city = parent;
      address.aerodrome = entry.name;
      break;
    case "landmark":
      if (parent) address.suburb = parent;
      address.landmark = entry.name;
      break;
    default:
      address.place = entry.name;
  }
  // `zoom` is accepted for Nominatim compatibility; at gazetteer granularity
  // it does not change which place wins (importance bias handles locality).
  if (entry.province) address.state = entry.province;

  const result: NominatimReverseResult = {
    place_id: entry.placeId,
    licence: LICENCE,
    osm_type: "node",
    osm_class: "place",
    type: entry.type,
    display_name: entry.displayName,
    name: entry.name,
    lat: entry.lat.toFixed(7),
    lon: entry.lng.toFixed(7),
    importance: entry.importance,
    address,
    boundingbox: [
      String(entry.bbox[0]),
      String(entry.bbox[2]),
      String(entry.bbox[1]),
      String(entry.bbox[3]),
    ] as [string, string, string, string],
    distance_km: Math.round(distanceKm * 10) / 10,
  };
  const outcome: ReverseOutcome = { status: 200, body: result };
  geocodeCache.set(cacheKey, outcome);
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api?q={query}&limit=6&lat=&lon=  (Photon-compatible autocomplete)
// ─────────────────────────────────────────────────────────────────────────────

export interface PhotonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    osm_id: number;
    osm_type: string;
    osm_key: string;
    osm_value: string;
    name: string;
    city?: string;
    state?: string;
    country: string;
    countrycode: string;
    type: string;
    extent: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  };
}

export interface PhotonResponse {
  type: "FeatureCollection";
  features: PhotonFeature[];
}

export function photonAutocomplete(
  query: string,
  limit = 6,
  lat?: number,
  lng?: number,
): PhotonResponse {
  const q = (query ?? "").trim();
  if (!q) return { type: "FeatureCollection", features: [] };
  const cappedLimit = Math.min(Math.max(1, limit), 20);
  const hasNear = typeof lat === "number" && typeof lng === "number" && !isNaN(lat) && !isNaN(lng);
  const cacheKey = `api:${q.toLowerCase()}:${cappedLimit}:${hasNear ? `${lat!.toFixed(3)}:${lng!.toFixed(3)}` : "-"}`;
  const cached = geocodeCache.get(cacheKey) as PhotonResponse | undefined;
  if (cached) return cached;

  let matches = scoredMatches(q);

  // Proximity bias: nearer results win, decaying to zero at 1200 km.
  if (hasNear) {
    matches = matches
      .map(({ entry, score }) => {
        const d = haversineKm({ lat: lat!, lng: lng! }, { lat: entry.lat, lng: entry.lng });
        const boost = 1.5 * Math.max(0, 1 - d / 1200);
        return { entry, score: score + boost };
      })
      .sort((a, b) => b.score - a.score);
  }

  const features: PhotonFeature[] = matches.slice(0, cappedLimit).map(({ entry }) => {
    const { osm_key, osm_value } = osmClassification(entry);
    const parent = entry.parent ? parentName(entry) : undefined;
    const properties: PhotonFeature["properties"] = {
      osm_id: entry.placeId,
      osm_type: "N",
      osm_key,
      osm_value,
      name: entry.name,
      city: parent ?? undefined,
      country: "Zimbabwe",
      countrycode: "ZW",
      type: entry.type,
      extent: [entry.bbox[1], entry.bbox[0], entry.bbox[3], entry.bbox[2]],
    };
    if (entry.province) properties.state = entry.province;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.lng, entry.lat] },
      properties,
    };
  });

  const response: PhotonResponse = { type: "FeatureCollection", features };
  geocodeCache.set(cacheKey, response);
  return response;
}
