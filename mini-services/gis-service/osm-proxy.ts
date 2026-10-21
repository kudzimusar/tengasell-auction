// osm-proxy.ts — REAL-planet raster basemap for the Tengasell map stack.
//
// The hand-drawn Zimbabwe vector tiles (country/water/roads/cities layers in
// tiles.ts) are a stylized offline fallback: at country zoom they look
// like a diagram, and users rightly expect a real map. This proxy streams
// genuine OpenStreetMap raster tiles (tile.openstreetmap.org "standard"
// style — the familiar beige/orange-roads look) through our own origin so
// the browser only ever talks to the gateway:
//
//   browser → /osm/{z}/{x}/{y}.png?XTransformPort=3004 → this proxy → OSM
//
// OSM tile usage policy compliance:
//   · identifying User-Agent (app name + contact), never a browser default
//   · disk + memory caching (tiles are immutable for our purposes)
//   · in-flight dedupe + max-6 concurrent upstream fetches (bulk friendly)
//   · negative cache so outages don't hammer the server
// If OSM is unreachable the style degrades gracefully: the synthetic
// vector layers sit underneath the raster layer and simply show through.
// Production swaps in any raster provider (infra/gis/docker-compose.yml)
// by changing OSM_UPSTREAM.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(SERVICE_DIR, ".tile-cache");

const OSM_UPSTREAM = process.env.OSM_UPSTREAM ?? "https://tile.openstreetmap.org";
const USER_AGENT =
  "Tengasell-Maps/1.0 (Zimbabwe auction marketplace; demo deploy; contact: dev@tengasell.example)";
export const OSM_MAX_ZOOM = 19;

const MEMORY_TILES = 3000; // ~3000 × 25 KB ≈ 75 MB worst case, usually far less
const NEGATIVE_TTL_MS = 90_000;
const NEGATIVE_MAX = 500;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_FETCHES = 6;

const memory = new Map<string, Uint8Array>();
const negative = new Map<string, number>();
const inflight = new Map<string, Promise<Uint8Array | null>>();

let activeFetches = 0;
const waitQueue: Array<() => void> = [];

const stats = {
  memoryHits: 0,
  diskHits: 0,
  upstreamFetches: 0,
  upstreamFailures: 0,
  negativeHits: 0,
  diskEntries: 0,
};

async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  activeFetches++;
  try {
    return await fn();
  } finally {
    activeFetches--;
    waitQueue.shift()?.();
  }
}

function rememberMemory(key: string, bytes: Uint8Array): void {
  if (memory.size >= MEMORY_TILES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest); // simple FIFO LRU-ish
  }
  memory.set(key, bytes);
}

function rememberNegative(key: string): void {
  if (negative.size >= NEGATIVE_MAX) negative.clear();
  negative.set(key, Date.now() + NEGATIVE_TTL_MS);
}

function isValidTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > OSM_MAX_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && y >= 0 && x < n && y < n;
}

async function fetchUpstream(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OSM_UPSTREAM}/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/png" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      stats.upstreamFailures++;
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("image/png") && !type.includes("application/octet-stream")) {
      stats.upstreamFailures++;
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 100) {
      stats.upstreamFailures++;
      return null;
    }
    stats.upstreamFetches++;
    // Best-effort disk persistence — cache misses never fail the request.
    const file = path.join(CACHE_DIR, `${z}-${x}-${y}.png`);
    void mkdir(path.dirname(file), { recursive: true })
      .then(() => writeFile(file, buf))
      .then(() => {
        stats.diskEntries++;
      })
      .catch(() => {});
    return buf;
  } catch {
    stats.upstreamFailures++;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a real OSM raster tile. Order: memory → disk → upstream (deduped,
 * concurrency-capped). Returns null when the tile can't be obtained —
 * the caller should then answer 502 + no-store so MapLibre falls back to
 * the synthetic vector basemap underneath.
 */
export async function getOsmTile(
  z: number,
  x: number,
  y: number,
): Promise<Uint8Array | null> {
  if (!isValidTile(z, x, y)) return null;
  const key = `${z}/${x}/${y}`;

  const mem = memory.get(key);
  if (mem) {
    memory.delete(key);
    memory.set(key, mem); // refresh recency
    stats.memoryHits++;
    return mem;
  }

  const neg = negative.get(key);
  if (neg !== undefined && Date.now() < neg) {
    stats.negativeHits++;
    return null;
  }
  if (neg !== undefined) negative.delete(key);

  const file = path.join(CACHE_DIR, `${z}-${x}-${y}.png`);
  try {
    const bytes = await readFile(file);
    rememberMemory(key, new Uint8Array(bytes));
    stats.diskHits++;
    return new Uint8Array(bytes);
  } catch {
    // disk miss — fall through to upstream
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = withFetchSlot(() => fetchUpstream(z, x, y))
    .then((bytes) => {
      if (bytes) {
        rememberMemory(key, bytes);
      } else {
        rememberNegative(key);
      }
      return bytes;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function osmProxyStats(): Record<string, number> {
  return {
    memoryHits: stats.memoryHits,
    diskHits: stats.diskHits,
    upstreamFetches: stats.upstreamFetches,
    upstreamFailures: stats.upstreamFailures,
    negativeHits: stats.negativeHits,
    diskEntries: stats.diskEntries,
    memoryEntries: memory.size,
    inflightRequests: inflight.size,
    activeUpstreamFetches: activeFetches,
  };
}
