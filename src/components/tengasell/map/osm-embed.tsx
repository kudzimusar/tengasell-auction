"use client";

// Tengasell Location & Maps — OpenStreetMap iframe embed (no API key).
// The iframe only mounts after the user expands the <details> summary, so
// no OSM request happens until then (performance); once mounted it is
// loading="lazy". Includes the required OSM attribution below the frame.

import { useState } from "react";
import { ChevronDown, MapIcon } from "lucide-react";
import { useI18n } from "@/lib/tengasell/i18n";
import { cn } from "@/lib/utils";
import { cityInfo } from "./cities";

export function OsmEmbed({ city, className }: { city: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const info = cityInfo(city);
  if (!info) return null;

  // ~34 km × ~22 km window around the city centre + marker
  const bbox = [
    (info.lng - 0.15).toFixed(4),
    (info.lat - 0.1).toFixed(4),
    (info.lng + 0.15).toFixed(4),
    (info.lat + 0.1).toFixed(4),
  ].join(",");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${info.lat},${info.lng}`;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={cn("rounded-card border border-border bg-raised", className)}
    >
      <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 rounded-card px-4 py-2 text-label text-foreground transition-colors hover:text-teal [&::-webkit-details-marker]:hidden">
        <MapIcon className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
        <span className="flex-1">
          {open ? t("location.hideMap") : t("location.showMap")}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-2 px-4 pb-4">
        {open && (
          <iframe
            src={src}
            title={`Map — ${info.name}`}
            loading="lazy"
            className="w-full h-56 rounded-card border border-border"
          />
        )}
        <p className="text-caption text-muted-foreground">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center hover:text-teal transition-colors"
          >
            {t("location.osmCredit")}
          </a>
        </p>
      </div>
    </details>
  );
}
