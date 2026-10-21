// routing.ts — OSRM-compatible routing over the Zimbabwe road graph.
//
// Model (documented honestly — this is a corridor-graph router, not a
// per-segment street router):
//   · Endpoints snap to the nearest road-graph node.
//   · Access legs (coordinate ↔ node) are haversine × 1.35 road-detour factor.
//   · Between-node legs follow Dijkstra over real corridor distances.
//   · Within-city trips (origin & destination < 40 km apart, i.e. the same
//     local cluster) use haversine × 1.35 directly with 2 curved midpoints.
//   · duration = distance / 65 km/h + 900 s city overhead for local trips.
//   · overview=full interpolates subtle midpoints on segments > 120 km so
//     direct corridor edges still look like roads on a map.

import { dijkstra, getNode, nearestNode } from "./roadgraph";
import { haversineKm } from "./gazetteer";
import { routeCache, tableCache } from "./cache";

export interface RouteError extends Error {
  status: number;
  code: string;
}

function routeError(status: number, code: string, message: string): RouteError {
  const err = new Error(message) as RouteError;
  err.status = status;
  err.code = code;
  return err;
}

// Tunables (spec constants)
const DETOUR_FACTOR = 1.35;
const SPEED_M_PER_H = 65000; // 65 km/h average
const CITY_OVERHEAD_S = 900;
const LOCAL_CLUSTER_KM = 40;
const SEGMENT_INTERP_KM = 120;
export const TABLE_MAX_COORDS = 10;

/** [lng, lat] OSRM-style coordinates. */
export type LngLat = [number, number];

const toLatLng = (c: LngLat) => ({ lat: c[1], lng: c[0] });

function coordKm(a: LngLat, b: LngLat): number {
  return haversineKm(toLatLng(a), toLatLng(b));
}

/** Linear interpolation between two lng/lat points with a perpendicular bulge. */
function curvedMidpoints(
  a: LngLat,
  b: LngLat,
  count: number,
  seed: number,
): LngLat[] {
  const out: LngLat[] = [];
  const dLng = b[0] - a[0];
  const dLat = b[1] - a[1];
  const len = Math.hypot(dLng, dLat) || 1e-9;
  // Unit perpendicular (in degree space — good enough for subtle curvature).
  const px = -dLat / len;
  const py = dLng / len;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const bulge = Math.sin(seed + i * 2.1) * 0.006 * t * (1 - t) * 4;
    out.push([
      a[0] + dLng * t + px * bulge,
      a[1] + dLat * t + py * bulge,
    ]);
  }
  return out;
}

function dedupe(points: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) {
      out.push(p);
    }
  }
  return out;
}

interface SolvedLeg {
  distanceMeters: number;
  durationSeconds: number;
  /** Waypoint names snapped for the two endpoints of this leg. */
  snapNames: [string, string];
}

function solveLeg(
  from: LngLat,
  to: LngLat,
  fullOverview: boolean,
  geometrySink?: LngLat[],
): SolvedLeg {
  const straightKm = coordKm(from, to);

  // Within-city / same-cluster leg: no graph path needed.
  if (straightKm < LOCAL_CLUSTER_KM) {
    const km = straightKm * DETOUR_FACTOR;
    const distanceMeters = km * 1000;
    const durationSeconds = (distanceMeters / SPEED_M_PER_H) * 3600 + CITY_OVERHEAD_S;
    if (geometrySink) {
      geometrySink.push(from, ...curvedMidpoints(from, to, 2, 0.7), to);
    }
    const nearA = nearestNode(from[1], from[0]);
    const nearB = nearestNode(to[1], to[0]);
    return {
      distanceMeters,
      durationSeconds,
      snapNames: [nearA.node.name, nearB.node.name],
    };
  }

  // Graph leg: snap → Dijkstra → snap.
  const snapA = nearestNode(from[1], from[0]);
  const snapB = nearestNode(to[1], to[0]);
  const graph = dijkstra(snapA.node.id, snapB.node.id);
  if (!graph) throw routeError(500, "NoRoute", "Road graph path not found");
  const km = snapA.km * DETOUR_FACTOR + graph.km + snapB.km * DETOUR_FACTOR;
  const distanceMeters = km * 1000;
  const durationSeconds = (distanceMeters / SPEED_M_PER_H) * 3600;

  if (geometrySink) {
    const nodePath = graph.path.map((id) => {
      const node = getNode(id)!;
      return [node.lng, node.lat] as LngLat;
    });
    const chain: LngLat[] = [from, ...nodePath, to];
    // Interpolate long segments with slight curvature (roads are never dead
    // straight at this scale) — full overview only.
    const detailed: LngLat[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      detailed.push(chain[i]);
      if (!fullOverview) continue;
      const segKm = coordKm(chain[i], chain[i + 1]);
      if (segKm > SEGMENT_INTERP_KM) {
        const midCount = Math.min(3, Math.max(1, Math.floor(segKm / SEGMENT_INTERP_KM)));
        detailed.push(...curvedMidpoints(chain[i], chain[i + 1], midCount, i * 1.3));
      }
    }
    detailed.push(chain[chain.length - 1]);
    geometrySink.push(...dedupe(detailed));
  }

  return {
    distanceMeters,
    durationSeconds,
    snapNames: [snapA.node.name, snapB.node.name],
  };
}

// ── OSRM polyline5 encoding (precision 1e-5 degrees) ─────────────────────────

function encodePolyline5(coords: LngLat[]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const chunk = (v: number): void => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    n = n >>> 0;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const nLat = Math.round(lat * 1e5);
    const nLng = Math.round(lng * 1e5);
    chunk(nLat - prevLat);
    chunk(nLng - prevLng);
    prevLat = nLat;
    prevLng = nLng;
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

export type Overview = "full" | "simplified" | "false";
export type Geometries = "geojson" | "polyline";

export interface OsrmRouteResponse {
  code: string;
  routes: {
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: LngLat[] } | { type: "LineString"; coordinates: string };
    legs: { distance: number; duration: number }[];
  }[];
  waypoints: { name: string; location: LngLat; distance: number; hint: string }[];
}

export interface RouteInput {
  coords: LngLat[];
  overview: Overview;
  geometries: Geometries;
}

export function solveRoute(input: RouteInput): OsrmRouteResponse {
  const { coords, overview, geometries } = input;
  if (coords.length < 2 || coords.length > TABLE_MAX_COORDS) {
    throw routeError(400, "InvalidUrl", "Expected 2–10 lon,lat pairs separated by ';'");
  }
  const cacheKey = `v1:${overview}:${geometries}:${JSON.stringify(coords)}`;
  const cached = routeCache.get(cacheKey) as OsrmRouteResponse | undefined;
  if (cached) return cached;

  const fullOverview = overview !== "simplified" && overview !== "false";
  const includeGeometry = overview !== "false";
  const geometry: LngLat[] = [];
  const legs: { distance: number; duration: number }[] = [];

  let distanceMeters = 0;
  let durationSeconds = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const from = coords[i];
    const to = coords[i + 1];
    const leg = solveLeg(from, to, fullOverview, includeGeometry ? geometry : undefined);
    distanceMeters += leg.distanceMeters;
    durationSeconds += leg.durationSeconds;
    legs.push({
      distance: Math.round(leg.distanceMeters),
      duration: Math.round(leg.durationSeconds),
    });
  }

  const shape: LngLat[] = dedupe(geometry);
  const response: OsrmRouteResponse = {
    code: "Ok",
    routes: [
      {
        distance: Math.round(distanceMeters),
        duration: Math.round(durationSeconds),
        geometry: includeGeometry
          ? {
              type: "LineString",
              coordinates:
                geometries === "polyline"
                  ? (encodePolyline5(shape) as unknown as LngLat[])
                  : shape,
            }
          : { type: "LineString", coordinates: [] },
        legs,
      },
    ],
    waypoints: coords.map((c) => {
      const snap = nearestNode(c[1], c[0]);
      const snapKm = coordKm(c, [snap.node.lng, snap.node.lat]);
      return {
        name: snap.node.name,
        location: [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6],
        distance: Math.round(snapKm * 1000),
        hint: "tengasell-gis",
      };
    }),
  };

  routeCache.set(cacheKey, response);
  return response;
}

export interface TableInput {
  coords: LngLat[];
  annotations: ("duration" | "distance")[];
}

export interface OsrmTableResponse {
  code: string;
  durations?: number[][];
  distances?: number[][];
}

export function solveTable(input: TableInput): OsrmTableResponse {
  const { coords, annotations } = input;
  if (coords.length < 2 || coords.length > TABLE_MAX_COORDS) {
    throw routeError(413, "TooBig", `Table limited to ${TABLE_MAX_COORDS} coordinates`);
  }
  const wantDuration = annotations.length === 0 || annotations.includes("duration");
  const wantDistance = annotations.includes("distance");
  const cacheKey = `v1:${wantDuration ? "d" : ""}${wantDistance ? "s" : ""}:${JSON.stringify(coords)}`;
  const cached = tableCache.get(cacheKey) as OsrmTableResponse | undefined;
  if (cached) return cached;

  const n = coords.length;
  const durations: number[][] = [];
  const distances: number[][] = [];
  const solved = new Map<number, { distance: number; duration: number }>();

  for (let i = 0; i < n; i++) {
    durations.push(new Array<number>(n).fill(0));
    distances.push(new Array<number>(n).fill(0));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const leg = solveLeg(coords[i], coords[j], false);
      const value = { distance: Math.round(leg.distanceMeters), duration: Math.round(leg.durationSeconds) };
      solved.set(i * 100 + j, value);
      distances[i][j] = value.distance;
      distances[j][i] = value.distance;
      durations[i][j] = value.duration;
      durations[j][i] = value.duration;
    }
  }

  const response: OsrmTableResponse = { code: "Ok" };
  if (wantDuration) response.durations = durations;
  if (wantDistance) response.distances = distances;
  tableCache.set(cacheKey, response);
  return response;
}

/** Parse "/route/v1/driving/{lng},{lat};{lng},{lat}" path suffix. */
export function parseCoordinateList(raw: string): LngLat[] {
  const coords: LngLat[] = [];
  for (const part of raw.split(";")) {
    const pieces = part.split(",").map((p) => Number(p.trim()));
    if (pieces.length !== 2 || !isFinite(pieces[0]) || !isFinite(pieces[1])) {
      throw routeError(400, "InvalidUrl", `Invalid coordinate '${part}'`);
    }
    const [lng, lat] = pieces;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw routeError(400, "InvalidUrl", `Coordinate out of range '${part}'`);
    }
    coords.push([lng, lat]);
  }
  return coords;
}
