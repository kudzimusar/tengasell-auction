"use client";

// Tengasell shipping & payments tab — Zimbabwe payment rails, shipping
// options, the Buyer Protection SLA panel (48h pay / 3-day dispatch /
// 7-day dispute / funds held until delivery confirmed), plus the item
// location: city card with mini map, optional "distance from you" line
// (explicit-use-only geolocation) and a lazy OpenStreetMap embed.

import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  HandCoins,
  Loader2,
  LocateFixed,
  MapPin,
  ShieldCheck,
  Truck,
  Undo2,
} from "lucide-react";
import { SLA, shippingLabel } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import type { Auction } from "@/lib/tengasell/types";
import { cityInfo } from "@/components/tengasell/map/cities";
import { LocationCard } from "@/components/tengasell/map/location-card";
import { OsmEmbed } from "@/components/tengasell/map/osm-embed";
import { CityMapDetails } from "@/components/tengasell/map/interactive-map";
import { useGeoCity } from "@/components/tengasell/map/use-geolocation";

const PAYMENT_METHODS = [
  "EcoCash",
  "Visa",
  "Mastercard",
  "PayPal",
  "ZIPIT",
  "Cash on delivery",
] as const;

export function ShippingPayments({ auction }: { auction: Auction }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const geo = useGeoCity();
  const pickupOnly = auction.shipping === "pickup";
  const dispatchNote =
    pickupOnly ? "Collection arranged with the seller after payment." : `Seller dispatches within ${SLA.shipWithinDays} days of payment (SLA).`;
  // Location block needs a known marketplace city (all seeded cities are).
  const cityKnown = !!cityInfo(auction.city);

  return (
    <div className="space-y-6 pt-4">
      {/* shipping */}
      <section aria-labelledby="ts-shipping-heading" className="rounded-card border border-border bg-raised p-4 space-y-3">
        <h3 id="ts-shipping-heading" className="text-label text-foreground flex items-center gap-2">
          <Truck className="size-4 text-teal-soft" aria-hidden="true" />
          Shipping
        </h3>
        <p className="text-body text-foreground font-semibold">
          {shippingLabel(auction.shipping, auction.shipping_fee)}
        </p>
        <ul className="space-y-1.5 text-caption text-muted-foreground">
          {pickupOnly && (
            <li className="flex items-start gap-2">
              <MapPin className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Local pickup{auction.city ? ` in ${auction.city}` : ""} — no courier for this
                listing. Inspect the item on collection.
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <Clock className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{dispatchNote}</span>
          </li>
        </ul>
      </section>

      {/* location — city card + optional distance from you + OSM embed */}
      {cityKnown && (
        <section aria-label={t("location.itemLocation")} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <motion.button
              type="button"
              onClick={geo.request}
              disabled={geo.requesting}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-raised px-4 text-label text-foreground transition-colors hover:border-teal/40 hover:text-teal focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              {geo.requesting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LocateFixed className="size-4" aria-hidden="true" />
              )}
              {geo.requesting ? t("location.locating") : t("location.useMyLocation")}
            </motion.button>
            {geo.error && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-caption text-danger min-w-0"
              >
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{geo.error}</span>
              </p>
            )}
          </div>
          <LocationCard city={auction.city} fromCity={geo.city ?? undefined} />
          <CityMapDetails city={auction.city} />
          <OsmEmbed city={auction.city} />
        </section>
      )}

      {/* payments */}
      <section aria-labelledby="ts-payments-heading" className="rounded-card border border-border bg-raised p-4 space-y-3">
        <h3 id="ts-payments-heading" className="text-label text-foreground flex items-center gap-2">
          <HandCoins className="size-4 text-gold-deep" aria-hidden="true" />
          Payment methods
        </h3>
        <ul className="flex flex-wrap gap-2" aria-label="Accepted payment methods">
          {PAYMENT_METHODS.map((method) => (
            <li
              key={method}
              className="rounded-full border border-border bg-section px-3 py-1.5 text-label text-foreground"
            >
              {method}
            </li>
          ))}
        </ul>
      </section>

      {/* buyer protection / SLA */}
      <section
        aria-labelledby="ts-protection-heading"
        className="rounded-card border border-teal/30 bg-teal-tint/60 dark:bg-teal-tint/30 p-4 space-y-3"
      >
        <h3 id="ts-protection-heading" className="text-title text-foreground flex items-center gap-2">
          <ShieldCheck className="size-5 text-teal-soft" aria-hidden="true" />
          Tengasell Buyer Protection
        </h3>
        <ul className="space-y-2 text-caption text-foreground">
          <li className="flex items-start gap-2">
            <Clock className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Pay within <strong>{SLA.payWithinHours}h</strong> of winning — unpaid wins are
              re-listed and accounts flagged.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Truck className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Sellers must dispatch within <strong>{SLA.shipWithinDays} days</strong> of payment.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Funds are held until delivery is confirmed — sellers get paid only after you
              receive the item.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Undo2 className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Open a dispute within <strong>{SLA.disputeWindowDays} days</strong> of delivery;
              refunds are processed within <strong>{SLA.refundDays} days</strong>.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
