// gis-service/index.ts — Tengasell GIS mini-service (port 3004).
//
// Open-source GIS stack contracts, zero dependencies (runs on bun or node):
//   · Nominatim-compatible  GET /search?q=&format=json&limit=
//   · Nominatim-compatible  GET /reverse?lat=&lon=&format=json
//   · Photon-compatible     GET /api?q=&limit=&lat=&lon=
//   · OSRM-compatible        GET /route/v1/driving/{lon},{lat};{lon},{lat}?overview=&geometries=
//   · OSRM-compatible        GET /table/v1/driving/{coords}?annotations=duration,distance
//   · TileServer-GL-style   GET /data/zimbabwe/{z}/{x}/{y}.pbf   (Mapbox Vector Tiles)
//   · REAL OSM raster proxy GET /osm/{z}/{x}/{y}.png  (cached; fallback = vector tiles)
//   · MapLibre style         GET /styles/tengasell.json[?absolute=1]
//   · Liveness + stats       GET /health
//
// Production replacements live in ../../infra/gis/docker-compose.yml
// (real Nominatim, Photon, OSRM, TileServer GL). The BFF in the Next app
// points at this service via GIS_BASE_URL (default http://localhost:3004).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { allCacheStats } from "./cache";
import { photonAutocomplete, reverseNominatim, searchNominatim } from "./geocode";
import {
  parseCoordinateList,
  solveRoute,
  solveTable,
  RouteError,
  type Geometries,
  type Overview,
} from "./routing";
import { buildTile, isValidTile, tengasellStyle, MAX_TILE_ZOOM } from "./tiles";
import { getOsmTile, osmProxyStats, OSM_MAX_ZOOM } from "./osm-proxy";

const PORT = 3004;
const startedAt = Date.now();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function isRouteError(err: unknown): err is RouteError {
  return (
    err instanceof Error &&
    typeof (err as unknown as { code?: unknown }).code === "string" &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (isRouteError(err)) {
    sendJson(res, err.status, { code: err.code, message: err.message });
    return;
  }
  console.error("[gis] unexpected error:", err);
  sendJson(res, 500, { code: "Internal", message: "Unexpected GIS error" });
}

const num = (raw: string | null): number | undefined => {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

interface Handler {
  method: string;
  pattern: RegExp;
  run: (req: IncomingMessage, match: RegExpMatchArray, url: URL, res: ServerResponse) => void;
}

const handlers: Handler[] = [];

function on(
  method: string,
  pattern: string,
  run: (req: IncomingMessage, match: RegExpMatchArray, url: URL, res: ServerResponse) => void,
): void {
  handlers.push({ method, pattern: new RegExp(`^${pattern}$`), run });
}

// ── Liveness ─────────────────────────────────────────────────────────────────
on("GET", "/health", (_req, _m, _url, res) =>
  sendJson(res, 200, {
    ok: true,
    service: "gis",
    port: PORT,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    caches: allCacheStats(),
    osm_tiles: osmProxyStats(),
  }),
);

// ── Forward geocoding (Nominatim /search) ───────────────────────────────────
on("GET", "/search", (_req, _m, url, res) => {
  const format = url.searchParams.get("format");
  if (format && format !== "json" && format !== "jsonv2") {
    sendJson(res, 400, { error: "Only format=json is supported" });
    return;
  }
  const q = url.searchParams.get("q") ?? "";
  const limit = num(url.searchParams.get("limit")) ?? 5;
  if (!q.trim()) {
    sendJson(res, 200, []);
    return;
  }
  const results = searchNominatim(q, limit);
  const detailId = num(url.searchParams.get("place_id"));
  if (detailId !== undefined) {
    const one = results.find((r) => r.place_id === detailId);
    if (one) sendJson(res, 200, one);
    else sendJson(res, 404, { error: "Unable to geocode" });
    return;
  }
  sendJson(res, 200, results);
});

// ── Reverse geocoding (Nominatim /reverse) ──────────────────────────────────
on("GET", "/reverse", (_req, _m, url, res) => {
  const lat = num(url.searchParams.get("lat"));
  const lon = num(url.searchParams.get("lon"));
  if (lat === undefined || lon === undefined) {
    sendJson(res, 400, { error: "lat and lon are required" });
    return;
  }
  const zoom = num(url.searchParams.get("zoom"));
  const outcome = reverseNominatim(lat, lon, zoom);
  sendJson(res, outcome.status, outcome.body);
});

// ── Autocomplete (Photon /api) ──────────────────────────────────────────────
on("GET", "/api", (_req, _m, url, res) => {
  const q = url.searchParams.get("q") ?? "";
  const limit = num(url.searchParams.get("limit")) ?? 6;
  const lat = num(url.searchParams.get("lat"));
  const lon = num(url.searchParams.get("lon"));
  sendJson(res, 200, photonAutocomplete(q, limit, lat, lon));
});

// ── Routing (OSRM /route/v1/driving) ────────────────────────────────────────
on("GET", "/route/v1/driving/(.+)", (_req, m, url, res) => {
  try {
    const coords = parseCoordinateList(m[1]);
    const overview = (url.searchParams.get("overview") ?? "full") as Overview;
    const geometries = (url.searchParams.get("geometries") ?? "polyline") as Geometries;
    sendJson(res, 200, solveRoute({ coords, overview, geometries }));
  } catch (err) {
    sendError(res, err);
  }
});

// ── Distance/duration matrix (OSRM /table/v1/driving) ────────────────────────
on("GET", "/table/v1/driving/(.+)", (_req, m, url, res) => {
  try {
    const coords = parseCoordinateList(m[1]);
    const annotationsRaw = url.searchParams.get("annotations") ?? "duration";
    const annotations = annotationsRaw
      .split(",")
      .map((a) => a.trim())
      .filter((a): a is "duration" | "distance" => a === "duration" || a === "distance");
    sendJson(res, 200, solveTable({ coords, annotations }));
  } catch (err) {
    sendError(res, err);
  }
});

// ── Not implemented against the sandbox graph ────────────────────────────────
on("GET", "/match/.*", (_req, _m, _url, res) =>
  sendJson(res, 501, {
    code: "NotImplemented",
    error: "Map matching is not part of the sandbox graph — use /route or the production OSRM container.",
  }),
);

// ── Vector tiles (TileServer-GL-style MVT) ──────────────────────────────────
on("GET", "/data/zimbabwe/([0-9]+)/([0-9]+)/([0-9]+)\\.pbf", (_req, m, _url, res) => {
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  if (!isValidTile(z, x, y) || z > MAX_TILE_ZOOM) {
    res.writeHead(404, CORS);
    res.end();
    return;
  }
  const bytes = buildTile(z, x, y);
  res.writeHead(200, {
    "Content-Type": "application/x-protobuf; charset=binary",
    "Content-Length": String(bytes.byteLength),
    // 10-minute browser caching: tiles are static per dataset, but encoder or
    // dataset updates must propagate to clients within minutes — "immutable"
    // would pin stale/broken tiles for a day.
    "Cache-Control": "public, max-age=600",
    ...CORS,
  });
  res.end(bytes);
});

// ── REAL OpenStreetMap raster tiles (cached proxy) ──────────────────────────
// Opaque PNGs served ABOVE the synthetic vector layers in the style: when
// they load, the map is the genuine article (real borders, real roads, real
// labels); when OSM is unreachable, MapLibre shows the vector layers beneath
// and the map degrades to the stylized offline basemap instead of breaking.
on("GET", "/osm/([0-9]+)/([0-9]+)/([0-9]+)\\.png", (_req, m, _url, res) => {
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  const invalid =
    !Number.isInteger(z) ||
    z < 0 ||
    z > OSM_MAX_ZOOM ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z;
  if (invalid) {
    res.writeHead(404, { ...CORS, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  getOsmTile(z, x, y)
    .then((bytes) => {
      if (res.writableEnded || res.destroyed) return;
      if (!bytes) {
        // Upstream miss — never cache failures in the browser.
        res.writeHead(502, { ...CORS, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        // Real OSM raster tiles are effectively immutable for an app's
        // lifetime — safe to pin for a day in the browser.
        "Cache-Control": "public, max-age=86400",
        ...CORS,
      });
      res.end(bytes);
    })
    .catch(() => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.writeHead(500, { ...CORS, "Cache-Control": "no-store" });
        res.end();
      } catch {
        /* client already gone */
      }
    });
});

// ── MapLibre style document ─────────────────────────────────────────────────
on("GET", "/styles/tengasell\\.json", (_req, _m, url, res) => {
  const absolute = url.searchParams.get("absolute") === "1";
  sendJson(res, 200, tengasellStyle(absolute));
});

// ── Server ──────────────────────────────────────────────────────────────────
createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  for (const h of handlers) {
    if (h.method !== req.method) continue;
    const match = pathname.match(h.pattern);
    if (match) {
      try {
        h.run(req, match, url, res);
      } catch (err) {
        sendError(res, err);
      }
      return;
    }
  }
  sendJson(res, 404, { error: `No such endpoint: ${req.method} ${pathname}` });
}).listen(PORT, () => {
  console.log(`[gis] Tengasell GIS service listening on :${PORT}`);
  console.log("[gis] endpoints: /health /search /reverse /api /route/v1/driving /table/v1/driving /data/zimbabwe/{z}/{x}/{y}.pbf /styles/tengasell.json");
});
