"use client";

// Tengasell item gallery — main image with arrows, thumbnail strip, badge
// overlays (Featured / Ending / Extended / status). Keyboard accessible.

import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { AuctionView } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

const FALLBACK_IMAGE = "/brand/hero-main.png";

function statusBadge(a: AuctionView): string | null {
  if (a.status === "live") return null;
  switch (a.status) {
    case "sold":
      return "Sold";
    case "ended":
      return "Ended";
    case "cancelled":
      return "Cancelled";
    case "draft":
      return "Draft";
    default:
      return null;
  }
}

export function Gallery({ auction }: { auction: AuctionView }) {
  const images = auction.imageList.length > 0 ? auction.imageList : [FALLBACK_IMAGE];
  const count = images.length;
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();

  // NOTE: the parent remounts this component with key={auction.id} when
  // navigating between items, so the index always starts at 0.

  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count],
  );

  const badge = statusBadge(auction);
  const multi = count > 1;

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="Item images"
        tabIndex={multi ? 0 : -1}
        onKeyDown={(e) => {
          if (!multi) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          }
        }}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <motion.img
          key={index}
          src={images[index]}
          alt={`${auction.title} — image ${index + 1} of ${count}`}
          loading="eager"
          initial={reduced ? undefined : { opacity: 0.4, scale: 1.01 }}
          animate={reduced ? undefined : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="size-full object-cover"
        />

        {/* badge overlays */}
        <div className="absolute top-2 start-2 flex flex-wrap gap-1 pointer-events-none">
          {auction.featured === 1 && (
            <span className="rounded-full bg-gold text-gold-on text-[10px] font-bold px-2.5 py-1 uppercase tracking-wide shadow-sm">
              Featured
            </span>
          )}
          {auction.status === "live" && auction.endingSoon && (
            <span className="rounded-full bg-urgent text-white text-[10px] font-bold px-2.5 py-1 uppercase tracking-wide shadow-sm">
              Ending
            </span>
          )}
          {auction.extension_count > 0 && (
            <span className="rounded-full bg-teal text-white text-[10px] font-bold px-2.5 py-1 uppercase tracking-wide shadow-sm">
              Extended
            </span>
          )}
          {badge && (
            <span className="rounded-full bg-foreground/90 text-background text-[10px] font-bold px-2.5 py-1 uppercase tracking-wide shadow-sm">
              {badge}
            </span>
          )}
        </div>

        {/* counter */}
        <span
          aria-live="polite"
          className="absolute bottom-2 end-2 rounded-pill bg-black/60 text-white text-caption px-2 py-1 ts-numeric"
        >
          {index + 1} / {count}
        </span>

        {multi && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous image"
              className="absolute top-1/2 -translate-y-1/2 start-2 size-11 grid place-items-center rounded-full bg-background/85 backdrop-blur border border-border text-foreground shadow-sm hover:bg-background transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next image"
              className="absolute top-1/2 -translate-y-1/2 end-2 size-11 grid place-items-center rounded-full bg-background/85 backdrop-blur border border-border text-foreground shadow-sm hover:bg-background transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {multi && (
        <div
          className="flex gap-2 overflow-x-auto ts-scrollbar pb-1"
          role="tablist"
          aria-label="Image thumbnails"
        >
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show image ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "relative shrink-0 w-20 h-14 sm:w-24 sm:h-16 overflow-hidden rounded-control border-2 transition-all focus-visible:ring-2 focus-visible:ring-ring outline-none",
                i === index
                  ? "border-teal opacity-100"
                  : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                className="size-full object-cover pointer-events-none"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
