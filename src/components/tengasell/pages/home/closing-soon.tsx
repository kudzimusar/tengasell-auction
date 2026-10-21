"use client";

// Closing-soon strip — horizontal rail of live auctions ending within
// 90 minutes, ordered by soonest end. Subscribes to trade-engine bus
// events (auction:update / auction:ended) via useResource so cards and
// countdowns stay live without a manual refresh.

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Zap } from "lucide-react";
import {
  AuctionCard,
  EmptyState,
  ErrorState,
  SectionHeader,
} from "@/components/tengasell/ui";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import type { Auction, AuctionQuery, Paginated } from "@/lib/tengasell/types";
import { LinkButton } from "./link-button";

const QUERY: AuctionQuery = {
  status: "live",
  endingWithinMinutes: 90,
  order: "ending",
  limit: 8,
};

function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-3 sm:gap-4 overflow-hidden" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="w-[min(70vw,228px)] sm:w-[240px] shrink-0 rounded-card border border-border bg-raised overflow-hidden"
        >
          <div className="aspect-[4/3] bg-muted animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-4 rounded bg-muted animate-pulse w-full" />
            <div className="h-4 rounded bg-muted animate-pulse w-2/3" />
            <div className="h-5 rounded bg-muted animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClosingSoon() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const res = useResource<Paginated<Auction>>(
    () => api.auctions(QUERY),
    [QUERY],
    { events: ["auction:update", "auction:ended"] },
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [res.data, updateArrows]);

  const nudge = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(el.clientWidth * 0.8, 300),
      behavior: reduced ? "auto" : "smooth",
    });
  };

  const items = res.data?.items ?? [];

  return (
    <section className="py-6" aria-label="Auctions closing soon">
      <div className="mx-auto max-w-7xl px-4">
        <SectionHeader
          icon={<Zap className="size-5 text-urgent" aria-hidden="true" />}
          title={<span className="text-urgent">Closing soon</span>}
          subtitle="Live auctions ending within 90 minutes — countdowns tick live"
          action={
            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-caption font-bold text-urgent me-1">
                <span className="size-2 rounded-full bg-urgent animate-pulse" aria-hidden="true" />
                LIVE
              </span>
              <div className="hidden md:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => nudge(-1)}
                  disabled={atStart}
                  aria-label="Previous auctions"
                  className="size-11 grid place-items-center rounded-full border border-border bg-raised text-foreground hover:bg-accent/60 disabled:opacity-40 disabled:cursor-default transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => nudge(1)}
                  disabled={atEnd}
                  aria-label="More auctions"
                  className="size-11 grid place-items-center rounded-full border border-border bg-raised text-foreground hover:bg-accent/60 disabled:opacity-40 disabled:cursor-default transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </div>
              <LinkButton to="/search?ending=90" variant="ghost" className="px-3">
                View all
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
            </div>
          }
        />
        {res.loading && !res.data ? (
          <div>
            <span role="status" className="sr-only">
              {t("state.loading")}
            </span>
            <RowSkeleton />
          </div>
        ) : res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Zap className="size-8" aria-hidden="true" />}
            title="No auctions closing soon"
            body="Live auctions ending within the next 90 minutes will appear here — check back in a little while."
            action={
              <LinkButton to="/search?ending=90" variant="ghost">
                Browse ending soon
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
            }
          />
        ) : (
          <div
            ref={scrollerRef}
            className="flex gap-3 sm:gap-4 overflow-x-auto ts-scrollbar snap-x snap-mandatory pb-2"
            role="list"
            aria-label="Auctions closing within 90 minutes"
          >
            {items.map((a) => (
              <div
                key={a.id}
                role="listitem"
                className="w-[min(70vw,228px)] sm:w-[240px] shrink-0 snap-start"
              >
                <AuctionCard auction={a} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
