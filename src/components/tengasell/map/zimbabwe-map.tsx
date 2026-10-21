"use client";

// Tengasell Location & Maps — REAL country locator mini-map.
//
// This used to be a hand-drawn SVG blob of Zimbabwe: honest, but users
// compared it to the real OSM embed and rightly called it "not a real
// map". It is now a compact, non-interactive MaplibreMap instance riding
// the SAME MapLibre style as every other Tengasell map — genuine
// OpenStreetMap raster basemap (real borders, roads, labels) with a gold
// marker pin-pointing the selected place at its exact coordinates. The
// gazetteer covers all 86 marketplace places (cities, towns, district
// centres), so small towns pin precisely instead of snapping to a hub.
//
// Sizing keeps the old self-sized contract: explicit width derived from
// the `height` prop with a 3:2 landscape aspect, so it centers itself in
// whatever container it lands in (LocationCard, sell wizard preview).

import { cityInfo } from "./cities";
import { MaplibreMap, type MapMarker } from "./maplibre-map";
import { useI18n } from "@/lib/tengasell/i18n";

/** Whole-country view: Zimbabwe comfortably inside the frame with real
 *  neighbouring borders visible at the edges — a locator, not a street map. */
const COUNTRY_CENTER: [number, number] = [29.85, -19.0];
const COUNTRY_ZOOM = 4.6;

export function ZimbabweMap({
  activeCity,
  height = 160,
}: {
  /** Pin-point this place (gold marker). Any gazetteer name — city, town
   *  or district centre. Unknown names render the bare country view. */
  activeCity?: string;
  /** Target height in px — width is height × 3:2, capped by the container. */
  height?: number;
}) {
  const { locale } = useI18n();
  const info = activeCity ? cityInfo(activeCity) : null;

  const markers: MapMarker[] = info
    ? [{ lat: info.lat, lng: info.lng, kind: "destination", label: info.name }]
    : [];

  const srText = info
    ? locale === "ja"
      ? `ジンバブエの地図 — 選択された場所は${info.name}（${info.province}）です`
      : `Map of Zimbabwe — selected location: ${info.name}, ${info.province}`
    : locale === "ja"
      ? "ジンバブエの地図"
      : "Map of Zimbabwe";

  return (
    <div
      data-testid="zimbabwe-map"
      className="relative mx-auto w-full"
      style={{
        maxWidth: Math.round(height * 1.5),
        aspectRatio: "3 / 2",
      }}
    >
      <p className="sr-only">{srText}</p>
      <MaplibreMap
        center={COUNTRY_CENTER}
        zoom={COUNTRY_ZOOM}
        markers={markers}
        fit={false}
        height="100%"
        interactive={false}
        className="size-full"
        ariaLabel={
          info
            ? `Mini-map of Zimbabwe — ${info.name}`
            : "Mini-map of Zimbabwe"
        }
      />
    </div>
  );
}
