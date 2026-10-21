"use client";

// delivery-card.tsx — checkout delivery panel: Photon address autocomplete +
// GIS delivery quote (distance, drive time, ETA, dynamic price estimate) +
// a compact route preview on the interactive map.
//
// The charged shipping fee stays the seller's listed fee — the GIS quote is
// an independent, data-driven estimate that helps buyers pick addresses and
// understand distance (and, for pickup listings, shows the collection point).

import { useEffect, useMemo, useState } from "react";
import { Clock, MapPin, Route as RouteIcon, Wallet } from "lucide-react";
import { cityInfo } from "./cities";
import { geoQuote, type GeoQuote, type GeoPlace } from "@/lib/tengasell/geo-client";
import { formatUSD } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import type { Auction } from "@/lib/tengasell/types";
import { MaplibreMap } from "./maplibre-map";
import { AddressAutocomplete } from "./address-autocomplete";

type ShippingKind = "courier" | "nationwide" | "pickup";

function shippingKind(auction: Auction): ShippingKind {
  const s = (auction.shipping ?? "").toLowerCase();
  if (s.startsWith("courier")) return "courier";
  if (s.startsWith("national") || s.startsWith("bus")) return "nationwide";
  if (s.startsWith("pickup")) return "pickup";
  return auction.shipping_fee > 0 ? "nationwide" : "courier";
}

export function DeliveryCard({
  auction,
  buyerCity,
  onAddress,
}: {
  auction: Auction;
  buyerCity?: string | null;
  /** Receives the current delivery-address displayName (or null). */
  onAddress?: (displayName: string | null) => void;
}) {
  const { locale } = useI18n();
  const origin = cityInfo(auction.city);
  const kind = shippingKind(auction);
  const [destination, setDestination] = useState<GeoPlace | null>(null);
  const [quote, setQuote] = useState<GeoQuote | null>(null);

  // Report the chosen delivery address upward (checkout stores it on the
  // order so tracking maps route to the real destination).
  useEffect(() => {
    onAddress?.(destination?.displayName ?? null);
  }, [destination, onAddress]);

  // Derived-state adjustment (React pattern): preselect the buyer's profile
  // city once it loads — starts as `undefined` so the first known city fires.
  const [prevBuyerCity, setPrevBuyerCity] = useState<string | null | undefined>(undefined);
  if (buyerCity !== prevBuyerCity) {
    setPrevBuyerCity(buyerCity);
    if (!destination && buyerCity) {
      const info = cityInfo(buyerCity);
      if (info) {
        setDestination({
          placeId: 0,
          name: info.name,
          displayName: `${info.name}, Zimbabwe`,
          lat: info.lat,
          lng: info.lng,
          type: "city",
        });
      }
    }
  }

  useEffect(() => {
    if (!origin || !destination || kind === "pickup") return;
    let alive = true;
    geoQuote({ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng }, kind).then(
      (q) => {
        if (!alive) return;
        setQuote(q);
      },
    );
    return () => {
      alive = false;
    };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, kind]);

  // Only show a quote that actually belongs to the selected destination.
  const liveQuote =
    quote &&
    destination &&
    Math.abs(quote.destination.lat - destination.lat) < 1e-6 &&
    Math.abs(quote.destination.lng - destination.lng) < 1e-6
      ? quote
      : null;

  const en = locale === "ja";
  const mapRoute = useMemo<[number, number][] | undefined>(() => liveQuote?.path, [liveQuote]);

  if (!origin) return null;

  if (kind === "pickup") {
    return (
      <section aria-label="Pickup location" className="rounded-card border border-border bg-raised p-4 sm:p-5">
        <h2 className="text-title text-foreground">{en ? "受け取り" : "Pickup"}</h2>
        <p className="mt-1 flex items-start gap-2 text-caption text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" />
          {en
            ? `出品者からの引き取り：${origin.name}（送料なし）`
            : `Buyer collects from ${origin.name} — no shipping fee.`}
        </p>
        <div className="mt-3">
          <MaplibreMap
            markers={[{ lat: origin.lat, lng: origin.lng, kind: "pin", label: `${origin.name} · pickup` }]}
            fit="markers"
            height={240}
            ariaLabel={`Pickup map — ${origin.name}`}
          />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Delivery details" className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <h2 className="text-title text-foreground">{en ? "お届け先" : "Delivery"}</h2>
      <p className="mt-1 text-caption text-muted-foreground">
        {en
          ? "住所を検索して配送の目安を確認 — 価格と所要時間はオープンソースのルートエンジンで計算。"
          : "Search your address for a delivery estimate — distance, time and price are computed by our open-source routing engine."}
      </p>

      <div className="mt-3">
        <label htmlFor="ts-checkout-address" className="sr-only">
          {en ? "配達先住所" : "Delivery address"}
        </label>
        <AddressAutocomplete
          id="ts-checkout-address"
          value={destination?.displayName ?? ""}
          near={{ lat: origin.lat, lng: origin.lng }}
          onSelect={setDestination}
          aria-label={en ? "配達先住所" : "Delivery address"}
        />
      </div>

      {destination && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip
            icon={<RouteIcon className="size-3.5" aria-hidden="true" />}
            label={en ? "距離" : "Distance"}
            value={liveQuote ? `${liveQuote.distanceKm} km` : "…"}
          />
          <StatChip
            icon={<Clock className="size-3.5" aria-hidden="true" />}
            label={en ? "配送目安" : "ETA"}
            value={liveQuote ? (en ? `${liveQuote.etaDays}日` : `${liveQuote.etaDays} day${liveQuote.etaDays > 1 ? "s" : ""}`) : "…"}
          />
          <StatChip
            icon={<Wallet className="size-3.5" aria-hidden="true" />}
            label={en ? "参考配送料" : "Est. delivery"}
            value={liveQuote ? formatUSD(liveQuote.priceUsd) : "…"}
          />
          <StatChip
            icon={<MapPin className="size-3.5" aria-hidden="true" />}
            label={en ? "出発地" : "From"}
            value={origin.name}
          />
        </div>
      )}

      {liveQuote && (
        <p className="mt-2 text-caption text-muted-foreground">
          {liveQuote.estimated ? (en ? "概算（直線距離ベース）" : "Estimated (straight-line fallback)") : en ? "道路距離ベース" : "Road-distance based"}
          {" · "}
          {en ? "請求される送料は出品者の設定額です" : "you're charged the seller's listed shipping fee"}
          {" · "}
          {formatUSD(auction.shipping_fee)}
        </p>
      )}

      {destination && mapRoute && mapRoute.length >= 2 && (
        <div className="mt-3">
          <MaplibreMap
            markers={[
              { lat: origin.lat, lng: origin.lng, kind: "origin", label: `${origin.name} · seller` },
              { lat: destination.lat, lng: destination.lng, kind: "destination", label: destination.name },
            ]}
            route={mapRoute}
            height={260}
            ariaLabel="Delivery route preview"
          />
        </div>
      )}
    </section>
  );
}

function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-control border border-border bg-canvas px-3 py-2">
      <span className="flex items-center gap-1 text-caption text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="ts-numeric mt-0.5 block truncate text-label font-bold text-foreground">{value}</span>
    </div>
  );
}
