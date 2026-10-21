// tiles.ts — slippy-map tile building over the Zimbabwe geo data + the
// MapLibre style document (TileServer-GL-compatible endpoints).
//
// · GET /data/zimbabwe/{z}/{x}/{y}.pbf   → application/x-protobuf (MVT 2.1)
// · GET /styles/tengasell.json            → MapLibre style JSON
//
// Tile math: z/x/y → Web-Mercator bounds → project features to tile-local
// coordinates on the 4096-unit layer extent, clip to the tile rect, encode.
// Served zooms: z0–z14. Encoded bytes are cached forever (bounded 5000 tiles).

import { MvtFeature, MvtGeometryType, MvtLayer, encodeTile } from "./mvt";
import {
  CITY_POINTS,
  ROAD_LINES,
  WATER_POLYGONS,
  ZIMBABWE_BOUNDS,
  ZIMBABWE_BORDER,
  LngLat,
} from "./zimbabwe-geo";
import { tileCache } from "./cache";

export const MAX_TILE_ZOOM = 14;
export const TILE_EXTENT = 4096;

type Pt = [number, number]; // tile-local coordinates on the layer extent

export function isValidTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const n = 2 ** z;
  return z >= 0 && z <= MAX_TILE_ZOOM && x >= 0 && y >= 0 && x < n && y < n;
}

// ── Web-Mercator projection into tile-local extent coordinates ───────────────

function makeProjector(z: number, x: number, y: number) {
  const n = 2 ** z;
  return (lng: number, lat: number): Pt => {
    const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
    const xt = ((lng + 180) / 360) * n - x;
    const latR = (clampedLat * Math.PI) / 180;
    const yt =
      ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n - y;
    return [xt * TILE_EXTENT, yt * TILE_EXTENT];
  };
}

// ── Clipping ─────────────────────────────────────────────────────────────────

/** Liang–Barsky clip of segment p→q against the tile rect; null = outside. */
function clipSegment(p: Pt, q: Pt): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const checks: Array<[number, number]> = [
    [-dx, p[0]],           // x ≥ 0
    [dx, TILE_EXTENT - p[0]], // x ≤ E
    [-dy, p[1]],           // y ≥ 0
    [dy, TILE_EXTENT - p[1]], // y ≤ E
  ];
  for (const [d, w] of checks) {
    if (d === 0) {
      if (w < 0) return null;
      continue;
    }
    const t = w / d;
    if (d < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  const a: Pt = [p[0] + t0 * dx, p[1] + t0 * dy];
  const b: Pt = [p[0] + t1 * dx, p[1] + t1 * dy];
  return [a, b];
}

/** Clip a polyline to the tile rect; returns the visible pieces. */
function clipPolyline(points: Pt[]): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const clipped = clipSegment(points[i], points[i + 1]);
    if (!clipped) {
      if (current.length >= 2) pieces.push(current);
      current = [];
      continue;
    }
    const [a, b] = clipped;
    if (current.length === 0 || !samePoint(current[current.length - 1], a)) {
      if (current.length >= 2) pieces.push(current);
      current = [a, b];
    } else {
      current.push(b);
    }
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
}

/** Sutherland–Hodgman clip of a ring against the tile rectangle. */
function clipRing(ring: Pt[]): Pt[] {
  const clipEdge = (
    pts: Pt[],
    inside: (p: Pt) => boolean,
    intersect: (a: Pt, b: Pt) => Pt,
  ): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    return out;
  };
  const lerpX = (a: Pt, b: Pt, x: number): Pt => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return [x, a[1] + t * (b[1] - a[1])];
  };
  const lerpY = (a: Pt, b: Pt, y: number): Pt => {
    const t = (y - a[1]) / (b[1] - a[1]);
    return [a[0] + t * (b[0] - a[0]), y];
  };
  let pts = ring;
  pts = clipEdge(pts, (p) => p[0] >= 0, (a, b) => lerpX(a, b, 0));
  if (!pts.length) return [];
  pts = clipEdge(pts, (p) => p[0] <= TILE_EXTENT, (a, b) => lerpX(a, b, TILE_EXTENT));
  if (!pts.length) return [];
  pts = clipEdge(pts, (p) => p[1] >= 0, (a, b) => lerpY(a, b, 0));
  if (!pts.length) return [];
  pts = clipEdge(pts, (p) => p[1] <= TILE_EXTENT, (a, b) => lerpY(a, b, TILE_EXTENT));
  return pts;
}

/**
 * Ensure the exterior ring is clockwise in screen space (y grows downward),
 * as required by the MVT spec. Shoelace > 0 = clockwise in y-down space.
 */
function ensureScreenClockwise(ring: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

const roundPt = (p: Pt): [number, number] => [Math.round(p[0]), Math.round(p[1])];

// ── Tile assembly ────────────────────────────────────────────────────────────

/**
 * Build the {z}/{x}/{y} MVT. Always returns a well-formed pbf: tiles that do
 * not intersect any feature still contain the four (empty) layers, matching
 * TileServer GL's "valid empty tile" behaviour.
 */
export function buildTile(z: number, x: number, y: number): Uint8Array {
  const cacheKey = `${z}/${x}/${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached) return cached;

  const project = makeProjector(z, x, y);

  // country (polygon)
  const countryFeatures: MvtFeature[] = [];
  const border = ensureScreenClockwise(
    ZIMBABWE_BORDER.map(([lng, lat]) => project(lng, lat)),
  );
  const clippedBorder = clipRing(border);
  if (clippedBorder.length >= 3) {
    countryFeatures.push({
      id: 1,
      type: MvtGeometryType.POLYGON,
      geometry: clippedBorder.map(roundPt),
      tags: { name: "Zimbabwe", class: "country" },
    });
  }

  // water (polygons)
  const waterFeatures: MvtFeature[] = [];
  for (const water of WATER_POLYGONS) {
    const ring = ensureScreenClockwise(
      water.ring.map(([lng, lat]) => project(lng, lat)),
    );
    const clipped = clipRing(ring);
    if (clipped.length >= 3) {
      waterFeatures.push({
        id: water.name === "Lake Kariba" ? 2 : 3,
        type: MvtGeometryType.POLYGON,
        geometry: clipped.map(roundPt),
        tags: { name: water.name, class: "water" },
      });
    }
  }

  // roads (lines)
  const roadFeatures: MvtFeature[] = [];
  let roadId = 1;
  for (const road of ROAD_LINES) {
    const pieces = clipPolyline(road.line.map(([lng, lat]) => project(lng, lat)));
    for (const piece of pieces) {
      roadFeatures.push({
        id: roadId++,
        type: MvtGeometryType.LINE,
        geometry: piece.map(roundPt),
        tags: { name: road.name, class: "road" },
      });
    }
  }

  // cities (points — every gazetteer place)
  const cityFeatures: MvtFeature[] = [];
  for (const place of CITY_POINTS) {
    const [px, py] = project(place.lng, place.lat);
    if (px < 0 || px >= TILE_EXTENT || py < 0 || py >= TILE_EXTENT) continue;
    cityFeatures.push({
      id: place.id,
      type: MvtGeometryType.POINT,
      geometry: [[Math.round(px), Math.round(py)]],
      tags: {
        name: place.name,
        class: place.class,
        population: place.populationClass,
        capital: place.capital,
        rank: place.rank,
      },
    });
  }

  const layers: MvtLayer[] = [
    { name: "country", features: countryFeatures },
    { name: "water", features: waterFeatures },
    { name: "roads", features: roadFeatures },
    { name: "cities", features: cityFeatures },
  ];

  const bytes = encodeTile(layers);
  tileCache.set(cacheKey, bytes);
  return bytes;
}

// ── MapLibre style document ──────────────────────────────────────────────────

export const DEFAULT_STYLE_TILE_URL =
  process.env.BASE_STYLE_URL ?? "/data/zimbabwe/{z}/{x}/{y}.pbf?XTransformPort=3004";
export const ABSOLUTE_STYLE_TILE_URL =
  "http://localhost:3004/data/zimbabwe/{z}/{x}/{y}.pbf";

/** Real OpenStreetMap raster tiles, served by this service's /osm proxy
 *  (disk + memory cached, OSM-policy-friendly). */
export const DEFAULT_OSM_TILE_URL = "/osm/{z}/{x}/{y}.png?XTransformPort=3004";
export const ABSOLUTE_OSM_TILE_URL = "http://localhost:3004/osm/{z}/{x}/{y}.png";

/**
 * Tengasell MapLibre style. The basemap is the REAL planet: genuine
 * OpenStreetMap raster tiles (beige land, orange roads, real borders and
 * labels) proxied through this service. The stylized vector layers
 * (country/water/roads) sit UNDERNEATH the raster — when OSM is reachable
 * they are simply covered; if the proxy ever fails per-tile, the synthetic
 * map shows through as a graceful offline fallback. Our gazetteer overlays
 * (cities/towns/districts/suburbs — teal dots, gold district rings, branded
 * labels) render ON TOP so Tengasell places stay pin-pointable.
 * Palette accents: teal #19717B, gold #DFAE2E, deep gold #AF7A14.
 * Glyphs come from the MapLibre demo glyph server — it currently serves
 * "Noto Sans Regular" / "Open Sans Semibold" ("Open Sans Regular" 404s —
 * verified against demotiles.maplibre.org/font).
 */
export function tengasellStyle(absolute: boolean): Record<string, unknown> {
  const tiles = [
    absolute ? ABSOLUTE_STYLE_TILE_URL : DEFAULT_STYLE_TILE_URL,
  ];
  const osmTiles = [
    absolute ? ABSOLUTE_OSM_TILE_URL : DEFAULT_OSM_TILE_URL,
  ];
  const font = ["Noto Sans Regular"];
  return {
    version: 8,
    id: "tengasell",
    name: "Tengasell",
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: osmTiles,
        maxzoom: 19,
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      tengasell: {
        type: "vector",
        tiles,
        maxzoom: MAX_TILE_ZOOM,
        bounds: ZIMBABWE_BOUNDS,
        attribution: "Tengasell GIS — Zimbabwe gazetteer & road graph",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f5f1e8" },
      },
      {
        id: "country-fill",
        type: "fill",
        source: "tengasell",
        "source-layer": "country",
        paint: { "fill-color": "#19717B", "fill-opacity": 0.12 },
      },
      {
        id: "country-outline",
        type: "line",
        source: "tengasell",
        "source-layer": "country",
        paint: { "line-color": "#19717B", "line-width": 1.5 },
      },
      {
        id: "water-fill",
        type: "fill",
        source: "tengasell",
        "source-layer": "water",
        paint: { "fill-color": "#6CBEC2", "fill-opacity": 0.55 },
      },
      {
        id: "roads-line",
        type: "line",
        source: "tengasell",
        "source-layer": "roads",
        paint: {
          "line-color": "#AF7A14",
          "line-width": { stops: [[4, 0.8], [8, 1.5], [12, 2.5], [14, 3]] },
        },
        layout: { "line-cap": "round", "line-join": "round" },
      },
      {
        // ── THE REAL PLANET ────────────────────────────────────────────────
        // Genuine OpenStreetMap raster tiles (proxy-cached). Opaque, so it
        // covers the stylized fallback stack below; if a proxy tile 502s
        // (OSM unreachable), the synthetic layer peeks through that gap.
        id: "osm-basemap",
        type: "raster",
        source: "osm-raster",
        paint: { "raster-opacity": 1 },
      },
      {
        id: "cities-circle",
        type: "circle",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 4,
        filter: [
          "match",
          ["get", "class"],
          ["city", "airport"],
          true,
          false,
        ],
        paint: {
          "circle-color": "#19717B",
          "circle-radius": { stops: [[4, 3], [8, 4.5], [14, 6]] },
          "circle-stroke-color": "#f5f1e8",
          "circle-stroke-width": 1,
        },
      },
      {
        id: "cities-label",
        type: "symbol",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 4,
        filter: ["match", ["get", "class"], ["city", "airport"], true, false],
        layout: {
          "text-field": ["get", "name"],
          "text-font": font,
          "text-size": { stops: [[4, 11], [10, 14]] },
          "text-anchor": "top",
          "text-offset": [0, 0.6],
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#0f4c52",
          "text-halo-color": "#f5f1e8",
          "text-halo-width": 1.5,
        },
      },
      {
        id: "towns-circle",
        type: "circle",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 5.5,
        filter: ["all", ["==", ["get", "class"], "town"], ["==", ["get", "rank"], 2]],
        paint: {
          "circle-color": "#19717B",
          "circle-radius": { stops: [[5, 2], [8, 3], [14, 4]] },
          "circle-stroke-color": "#f5f1e8",
          "circle-stroke-width": 1,
        },
      },
      {
        id: "towns-label",
        type: "symbol",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 6,
        filter: ["all", ["==", ["get", "class"], "town"], ["==", ["get", "rank"], 2]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": font,
          "text-size": { stops: [[6, 10], [12, 13]] },
          "text-anchor": "top",
          "text-offset": [0, 0.55],
        },
        paint: {
          "text-color": "#6b5a1e",
          "text-halo-color": "#f5f1e8",
          "text-halo-width": 1.2,
        },
      },
      {
        id: "small-towns-circle",
        type: "circle",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 7.5,
        filter: ["all", ["==", ["get", "class"], "town"], ["==", ["get", "rank"], 3]],
        paint: {
          "circle-color": "#19717B",
          "circle-radius": { stops: [[7, 1.8], [10, 2.6], [14, 3.5]] },
          "circle-stroke-color": "#f5f1e8",
          "circle-stroke-width": 1,
        },
      },
      {
        id: "small-towns-label",
        type: "symbol",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 8,
        filter: ["all", ["==", ["get", "class"], "town"], ["==", ["get", "rank"], 3]],
        layout: {
          "text-field": ["get", "name"],
          "text-font": font,
          "text-size": { stops: [[8, 9.5], [13, 12]] },
          "text-anchor": "top",
          "text-offset": [0, 0.5],
        },
        paint: {
          "text-color": "#3d4a4c",
          "text-halo-color": "#f5f1e8",
          "text-halo-width": 1,
        },
      },
      {
        id: "districts-ring",
        type: "circle",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 6.5,
        filter: ["==", ["get", "class"], "district"],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": { stops: [[6, 5], [9, 8], [14, 12]] },
          "circle-stroke-color": "#AF7A14",
          "circle-stroke-width": 1.2,
          "circle-stroke-opacity": 0.75,
        },
      },
      {
        id: "districts-label",
        type: "symbol",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 8.5,
        filter: ["==", ["get", "class"], "district"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": font,
          "text-size": { stops: [[8, 8.5], [12, 10.5]] },
          "text-transform": "uppercase",
          "text-letter-spacing": 0.12,
          "text-anchor": "center",
          "text-offset": [0, 1.4],
        },
        paint: {
          "text-color": "#8a6a1f",
          "text-halo-color": "#f5f1e8",
          "text-halo-width": 1.2,
        },
      },
      {
        id: "suburbs-label",
        type: "symbol",
        source: "tengasell",
        "source-layer": "cities",
        minzoom: 9,
        filter: ["match", ["get", "class"], ["suburb", "landmark"], true, false],
        layout: {
          "text-field": ["get", "name"],
          "text-font": font,
          "text-size": { stops: [[9, 10], [13, 12]] },
          "text-anchor": "top",
          "text-offset": [0, 0.5],
        },
        paint: {
          "text-color": "#3d4a4c",
          "text-halo-color": "#f5f1e8",
          "text-halo-width": 1,
        },
      },
    ],
  };
}
