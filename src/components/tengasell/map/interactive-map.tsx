"use client";

// interactive-map.tsx — lazy city map + order tracking map built on the
// core MaplibreMap. Both load only when their <details> is expanded (or the
// section renders), keeping the bundle and the tile service untouched until
// the user actually wants the map.

import { useEffect, useState } from "react";
import { ChevronDown, Package, Truck } from "lucide-react";
import { cityInfo } from "./cities";
import { geoRoute } from "@/lib/tengasell/geo-client";
import { formatRelative, SLA } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import { MaplibreMap, type MapMarker } from "./maplibre-map";

/** City marker map inside a collapsible "Show map" details block. */
export function CityMapDetails({ city, height = 300 }: { city: string; height?: number }) {
  const { locale } = useI18n();
  const info = cityInfo(city);
  const [open, setOpen] = useState(false);
  const label = locale === "ja" ? "地図を表示" : "Show interactive map";
  if (!info) return null;

  return (
    <details className="rounded-control border border-border bg-raised" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-label font-semibold text-teal">
        <span>{label}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </summary>
      <div className="p-3 pt-0">
        {open && (
          <MaplibreMap
            markers={[{ lat: info.lat, lng: info.lng, kind: "pin", label: info.name }]}
            fit="markers"
            height={height}
            ariaLabel={`Interactive map — ${info.name}`}
          />
        )}
      </div>
    </details>
  );
}

interface TrackingMapProps {
  originCity: string;
  destinationCity: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrier: string | null;
  tracking: string | null;
  auctionId: number;
}

/**
 * Order tracking map: origin (seller city) → destination (buyer city) with a
 * simulated live courier position along the OSRM-style route. Progress is
 * interpolated from shipped_at vs the routed duration and updates every 10s.
 * Delivery (or the SLA horizon) clamps the courier at the destination.
 */
export function TrackingMap({
  originCity,
  destinationCity,
  shippedAt,
  deliveredAt,
  carrier,
  tracking,
  auctionId,
}: TrackingMapProps) {
  const { locale } = useI18n();
  const origin = cityInfo(originCity);
  const destination = cityInfo(destinationCity);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!origin || !destination) return;
    let alive = true;
    geoRoute({ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng }).then(
      (r) => {
        if (!alive || !r) return;
        setRoute(r.coordinates);
        setDurationS(r.durationSeconds);
        setDistanceKm(Math.round(r.distanceMeters / 100) / 10);
      },
    );
    return () => {
      alive = false;
    };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  // Live position refresh (simulated feed until real courier GPS lands).
  useEffect(() => {
    if (!shippedAt || deliveredAt) return;
    const iv = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(iv);
  }, [shippedAt, deliveredAt, tick]);

  if (!origin || !destination || originCity === destinationCity) return null;

  const markers: MapMarker[] = [
    { lat: origin.lat, lng: origin.lng, kind: "origin", label: `${origin.name} · pickup` },
    { lat: destination.lat, lng: destination.lng, kind: "destination", label: `${destination.name} · delivery` },
  ];

  let progress = 0;
  let etaText: string | null = null;
  if (shippedAt && durationS) {
    const shippedMs = new Date(shippedAt).getTime();
    const elapsedS = (Date.now() - shippedMs) / 1000;
    progress = deliveredAt
      ? 1
      : Math.max(0.04, Math.min(0.96, elapsedS / Math.max(durationS, 1)));
    const remainMin = Math.max(0, Math.round((durationS * (deliveredAt ? 0 : 1 - progress)) / 60));
    const remainH = Math.floor(remainMin / 60);
    const days = Math.floor(remainH / 24);
    etaText = locale === "ja"
      ? (deliveredAt
          ? `配達完了 · ${formatRelative(deliveredAt)}`
          : `到着まで約 ${days > 0 ? `${days}日` : remainH > 0 ? `${remainH}時間` : `${remainMin}分`}`)
      : (deliveredAt
          ? `Delivered · ${formatRelative(deliveredAt)}`
          : `Arriving in about ${days > 0 ? `${days}d` : remainH > 0 ? `${remainH}h` : `${remainMin}m`}`);
  }

  const chip =
    locale === "ja"
      ? { live: "追跡（シミュレーション）", item: "商品" }
      : { live: "Live tracking · simulated", item: "Item" };

  return (
    <section
      aria-label="Live tracking map"
      className="overflow-hidden rounded-card border border-border bg-raised"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Truck className="size-4 text-teal" aria-hidden="true" />
          <h3 className="text-label font-bold text-foreground">
            {locale === "ja" ? "配送追跡" : "Delivery tracking"}
          </h3>
          {!deliveredAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-tint px-2 py-0.5 text-caption font-semibold text-teal-deep dark:text-teal-soft">
              <span className="size-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
              {chip.live}
            </span>
          )}
        </div>
        <p className="ts-numeric text-caption text-muted-foreground">
          {carrier ?? "Carrier"} · {tracking ?? "—"}
        </p>
      </header>
      <div className="p-3">
        <MaplibreMap
          markers={markers}
          route={route ?? undefined}
          progress={shippedAt && route ? progress : undefined}
          height={300}
          ariaLabel={`Tracking map from ${origin.name} to ${destination.name}`}
        />
        <div className="mt-2 grid grid-cols-2 gap-2 text-caption text-muted-foreground sm:grid-cols-4">
          <span className="truncate">
            <Package className="me-1 inline size-3.5" aria-hidden="true" />
            {chip.item} #{auctionId}
          </span>
          <span className="ts-numeric truncate">{distanceKm !== null ? `${distanceKm} km` : "—"}</span>
          <span className="truncate">{etaText ?? `Dispatch SLA ${SLA.shipWithinDays} days`}</span>
          <span className="truncate">
            {origin.name} → {destination.name}
          </span>
        </div>
      </div>
    </section>
  );
}
