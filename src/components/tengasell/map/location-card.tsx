"use client";

// Tengasell Location & Maps — reusable city card.
// MapPin + city + province, an optional haversine distance line
// ("~439 km from Harare"), a compact Zimbabwe mini-map preview and a
// "Get directions" external link (Google Maps directions, no API key).

import { motion, useReducedMotion } from "framer-motion";
import { MapPin, Navigation } from "lucide-react";
import { compactNumber } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import { cn } from "@/lib/utils";
import { cityDistanceKm, cityInfo } from "./cities";
import { ZimbabweMap } from "./zimbabwe-map";

/** "~439 km from Harare" / "ハラレから約439km" — composed per locale
 *  (t() has no interpolation support; see i18n.tsx). */
function distanceLine(km: number, fromCity: string, locale: "en" | "ja"): string {
  const v = compactNumber(Math.round(km));
  return locale === "ja" ? `${fromCity}から約${v}km` : `~${v} km from ${fromCity}`;
}

export function LocationCard({
  city,
  fromCity,
  compact = false,
  className,
}: {
  city: string;
  /** Show the distance line measured from this city (haversine). */
  fromCity?: string;
  /** Condensed layout for tight spots (profile header etc.): no blurb,
   *  smaller map, row layout on wider screens. */
  compact?: boolean;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const reduced = useReducedMotion();
  const info = cityInfo(city);
  if (!info) return null;

  const km = fromCity ? cityDistanceKm(fromCity, info.name) : null;
  const sameCity = km != null && km < 30;
  const line =
    km == null
      ? null
      : sameCity
        ? t("location.sameCity")
        : distanceLine(km, fromCity!, locale);

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${info.lat},${info.lng}`;
  const mapHeight = compact ? 100 : 120;

  return (
    <div
      className={cn(
        "rounded-card border border-border bg-raised p-4",
        compact ? "sm:p-4" : "sm:p-5",
        "space-y-3",
        className,
      )}
      aria-label={`${t("location.itemLocation")}: ${info.name}, ${info.province}`}
    >
      <div
        className={cn(
          "flex gap-4",
          compact ? "flex-col sm:flex-row sm:items-center" : "flex-wrap items-start justify-between gap-3",
        )}
      >
        <div className="min-w-0 flex-1">
          {/* NB: size (text-label/text-title) + color (text-foreground) tokens
              must NOT pass through cn() together — twMerge treats every
              custom `text-*` token as the same group and drops one; as plain
              classes they apply to different CSS properties and coexist. */}
          <p
            className={`flex items-center gap-1.5 text-foreground ${compact ? "text-label" : "text-title"}`}
          >
            <MapPin
              className={cn("text-teal-soft shrink-0", compact ? "size-4" : "size-5")}
              aria-hidden="true"
            />
            {info.name}
          </p>
          <p className="text-caption text-muted-foreground mt-0.5">{info.province}</p>
          {line && (
            <p
              className={`mt-1 ts-numeric font-semibold ${sameCity ? "text-ok" : "text-teal"} ${compact ? "text-caption" : "text-label"}`}
            >
              {line}
            </p>
          )}
          {!compact && info.blurb && (
            <p className="text-caption text-muted-foreground mt-1.5 max-w-md">{info.blurb}</p>
          )}
          {!compact && !info.blurb && (
            <p className="text-caption text-muted-foreground mt-1.5 max-w-md">{info.province}</p>
          )}
          <motion.a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer noopener"
            whileTap={reduced ? undefined : { scale: 0.97 }}
            className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-control text-caption font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring transition-colors"
          >
            <Navigation className="size-3.5" aria-hidden="true" />
            {t("location.directions")}
          </motion.a>
        </div>
        <div className={cn("shrink-0", compact ? "mx-auto sm:mx-0" : "w-full")}>
          <ZimbabweMap height={mapHeight} activeCity={info.name} />
        </div>
      </div>
    </div>
  );
}
