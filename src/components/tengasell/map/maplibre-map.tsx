"use client";

// maplibre-map.tsx — interactive Tengasell map on MapLibre GL JS.
//
// Vector tiles + style come from the Tengasell GIS stack (:3004 through the
// gateway) — no proprietary map SDKs. Markers and the route line are plain
// DOM/GeoJSON, so they render even if the tile service is unreachable.
// maplibre-gl is dynamically imported (SSR-safe, out of the initial bundle);
// its CSS is pulled once with the module.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { pointAlong } from "@/lib/tengasell/geo-client";
import { cn } from "@/lib/utils";

// Gateway-safe style URL (Caddy forwards ?XTransformPort=3004 to the GIS
// service, whose style embeds the same query on its tile URLs).
const STYLE_URL = "/styles/tengasell.json?XTransformPort=3004";

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  kind?: "origin" | "destination" | "courier" | "pin";
}

interface MaplibreMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  route?: [number, number][];
  /** 0..1 — position of the courier marker along the route. */
  progress?: number;
  fit?: "route" | "markers" | false;
  height?: number | string;
  interactive?: boolean;
  className?: string;
  ariaLabel?: string;
}

type MaplibreNS = typeof import("maplibre-gl");
type MapRef = import("maplibre-gl").Map;
type MarkerRef = import("maplibre-gl").Marker;

const MARKER_KIND: Record<string, { bg: string; ring: string }> = {
  origin: { bg: "#19717B", ring: "#19717B33" },
  destination: { bg: "#DFAE2E", ring: "#DFAE2E33" },
  courier: { bg: "#AF7A14", ring: "#AF7A1444" },
  pin: { bg: "#19717B", ring: "#19717B33" },
};

function markerEl(kind: string, label?: string): HTMLElement {
  const styles = MARKER_KIND[kind] ?? MARKER_KIND.pin;
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:26px;height:26px;";
  el.innerHTML =
    `<span style="position:absolute;inset:0;border-radius:9999px;background:${styles.ring};"></span>` +
    `<span style="position:absolute;inset:6px;border-radius:9999px;background:${styles.bg};box-shadow:0 1px 3px #0006;"></span>`;
  if (kind === "courier") {
    el.innerHTML +=
      `<span style="position:absolute;inset:2px;border-radius:9999px;border:2px solid ${styles.bg};opacity:.7;animation:ts-map-pulse 1.8s ease-out infinite;"></span>`;
  }
  if (label) el.setAttribute("title", label);
  el.setAttribute("aria-label", label ?? "map marker");
  return el;
}

// Shared pulse keyframes (injected once).
let pulseInjected = false;
function injectPulse(): void {
  if (pulseInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent =
    "@keyframes ts-map-pulse{0%{transform:scale(.7);opacity:.9}80%{transform:scale(1.5);opacity:0}100%{transform:scale(1.5);opacity:0}}";
  document.head.appendChild(style);
  pulseInjected = true;
}

export function MaplibreMap({
  center,
  zoom = 5,
  markers = [],
  route,
  progress,
  fit = "route",
  height = 320,
  interactive = true,
  className,
  ariaLabel = "Interactive map of Zimbabwe",
}: MaplibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  const libRef = useRef<MaplibreNS | null>(null);
  const markersRef = useRef<MarkerRef[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Mount once — create the map, add the route source/layers, flag ready.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let map: MapRef | null = null;
    let resizeOb: ResizeObserver | null = null;

    injectPulse();
    (async () => {
      let maplibre: MaplibreNS;
      try {
        maplibre = await import("maplibre-gl");
      } catch {
        setFailed(true);
        return;
      }
      if (disposed || !containerRef.current) return;
      libRef.current = maplibre;
      // Turbopack rewrites import.meta.url so MapLibre can't locate its web
      // worker — point it at the self-contained worker we serve from /public
      // (copied from maplibre-gl/dist/maplibre-gl-worker.mjs, v6.15.0).
      if (typeof maplibre.setWorkerUrl === "function") {
        maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs?v=6.15.0");
      }
      map = new maplibre.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: center ?? [29.9, -19.0],
        zoom,
        attributionControl: false,
        interactive,
      });
      map.on("error", (e) => {
        // Surface style/tile problems in dev without breaking the UI.
        console.warn("[map] MapLibre error:", (e as { error?: unknown }).error ?? e);
      });
      map.on("load", () => {
        if (disposed || !map) return;
        map.addSource("ts-route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "ts-route-casing",
          type: "line",
          source: "ts-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#DFAE2E", "line-width": 8, "line-opacity": 0.35 },
        });
        map.addLayer({
          id: "ts-route-line",
          type: "line",
          source: "ts-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#19717B", "line-width": 3.5 },
        });
        mapRef.current = map;
        setReady(true);
      });
      resizeOb = new ResizeObserver(() => map?.resize());
      resizeOb.observe(containerRef.current);
    })();

    return () => {
      disposed = true;
      resizeOb?.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // deps: intentionally one-shot mount (map instance); inputs flow through refs/handlers
  }, []);

  // Route geometry + fit bounds (whenever the route polyline changes).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("ts-route") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!src) return;
    if (route && route.length >= 2) {
      src.setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } },
        ],
      });
      if (fit === "route") {
        const lons = route.map((c) => c[0]);
        const lats = route.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 48, duration: 400, maxZoom: 9 },
        );
      }
    } else {
      src.setData({ type: "FeatureCollection", features: [] });
      if (fit === "markers" && markers.length > 0) {
        const lons = markers.map((m) => m.lng);
        const lats = markers.map((m) => m.lat);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 56, duration: 400, maxZoom: 10 },
        );
      }
    }
  }, [route, ready, fit, markers]);

  // Markers + courier position along the route.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const all: MapMarker[] = [...markers];
    if (route && route.length >= 2 && progress !== undefined) {
      const pos = pointAlong(route, Math.max(0, Math.min(1, progress)));
      all.push({ lat: pos[1], lng: pos[0], kind: "courier", label: "Courier" });
    }
    for (const m of all) {
      const el = markerEl(m.kind ?? "pin", m.label);
      const marker = new lib.Marker({ element: el, anchor: "center" });
      marker.setLngLat([m.lng, m.lat]).addTo(map);
      markersRef.current.push(marker);
    }
    if (!route && fit === "markers" && all.length > 0) {
      const lons = all.map((m) => m.lng);
      const lats = all.map((m) => m.lat);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 56, duration: 400, maxZoom: 10 },
      );
    }
  }, [markers, progress, route, ready, fit]);

  if (failed) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-card border border-border bg-raised text-caption text-muted-foreground",
          className,
        )}
        style={{ height } as CSSProperties}
        role="img"
        aria-label={ariaLabel}
      >
        Map engine unavailable
      </div>
    );
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-card border border-border bg-canvas", className)}
      style={{ height } as CSSProperties}
      role="region"
      aria-label={ariaLabel}
    >
      {/* Inline styles (not Tailwind classes): MapLibre's stylesheet declares
          `.maplibregl-map { position: relative }` UNLAYERED, which beats any
          Tailwind v4 `@layer utilities` rule and collapsed the container to
          content height. Inline styles can never lose that cascade fight. */}
      <div
        ref={containerRef}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* OSM raster basemap attribution — required whenever the real
          OpenStreetMap tiles are shown. Compact chip; the full credit
          link lives beside the map on the item page (OsmEmbed) and in
          the style source metadata. */}
      {!failed && (
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Map data © OpenStreetMap contributors"
          className="absolute bottom-1 end-1 z-10 rounded-xs bg-background/75 px-1 py-px text-[9px] leading-tight font-medium text-muted-foreground backdrop-blur-[2px] transition-colors hover:text-teal"
        >
          © OpenStreetMap
        </a>
      )}
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-canvas/80 text-caption text-muted-foreground">
          Loading map…
        </div>
      )}
    </div>
  );
}
