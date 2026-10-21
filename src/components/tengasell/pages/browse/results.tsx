"use client";

// Tengasell browse — results feed. Server-ordered query (TrailBase or demo
// store), 48 items per page with a "Load more" window, live refresh via bus
// events (auction:update / auction:ended from the trade engine). The parent
// remounts this section (key=queryKey) whenever the query changes so every
// view starts with a fresh skeleton state — no cross-query stale results.

import { useEffect, useState } from "react";
import { Loader2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AuctionCard,
  EmptyState,
  ErrorState,
  LoadingGrid,
} from "@/components/tengasell/ui";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import type { AuctionQuery } from "@/lib/tengasell/types";
import { ListRow } from "./list-row";

const PAGE_SIZE = 48;

export interface PopularCategory {
  slug: string;
  name: string;
}

function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 sm:gap-4 p-3 sm:p-4 rounded-card border border-border bg-raised"
        >
          <div className="w-24 h-24 sm:w-36 sm:h-28 shrink-0 rounded-input bg-muted animate-pulse" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
            <div className="h-5 bg-muted rounded animate-pulse w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultsSection({
  query,
  queryKey,
  view,
  freeShipping,
  hasActiveFilters,
  onClearFilters,
  onCountChange,
  popularCategories,
}: {
  query: AuctionQuery;
  queryKey: string;
  view: "grid" | "list";
  freeShipping: boolean;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onCountChange: (count: number) => void;
  popularCategories: PopularCategory[];
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  const res = useResource(
    () => api.auctions({ ...query, limit, offset: 0 }),
    [queryKey, limit],
    { events: ["auction:update", "auction:ended"] },
  );

  const items = res.data?.items ?? [];
  // free-shipping-only is a client-side rule (shipping_fee === 0)
  const shown = freeShipping ? items.filter((a) => a.shipping_fee === 0) : items;
  const total = res.data?.total ?? 0;
  const shownTotal = freeShipping ? shown.length : total;
  const remaining = Math.max(0, total - shown.length);
  const canLoadMore = items.length < total && !res.error;

  // report the count to the page header (skip while loading → no 0-flash)
  useEffect(() => {
    if (!res.loading) onCountChange(shownTotal);
  }, [res.loading, shownTotal, onCountChange]);

  // a refresh with existing data = either "load more" or a live bus event
  const refreshing = res.loading && res.data != null;

  const loadMore = () => setLimit((l) => l + PAGE_SIZE);

  const countText =
    shown.length === 0
      ? "0 auctions"
      : `1\u2013${shown.length} of ${shownTotal} auctions`;

  if (res.error) {
    return (
      <div>
        <p className="text-caption text-muted-foreground mb-3">
          Could not load results.
        </p>
        <ErrorState message={res.error} onRetry={res.reload} />
      </div>
    );
  }

  if (res.loading && !res.data) {
    return (
      <div aria-busy="true" aria-live="polite">
        <div className="h-4 w-40 rounded bg-muted animate-pulse mb-4" />
        {view === "grid" ? <LoadingGrid count={12} /> : <ListSkeleton count={6} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-caption text-muted-foreground ts-numeric" aria-live="polite">
          {countText} · live listings
        </p>
        {refreshing && (
          <span className="inline-flex items-center gap-1 text-caption text-teal font-semibold">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <>
          <EmptyState
            icon={<SearchX className="size-9" />}
            title="No auctions match"
            body={
              hasActiveFilters
                ? "No live auctions match these filters — try clearing them, or explore a popular category below."
                : "Nothing live here right now — try a different search, or explore a popular category below."
            }
            action={
              hasActiveFilters ? (
                <Button
                  variant="outline"
                  className="h-11 px-5 rounded-control"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
          {popularCategories.length > 0 && (
            <nav
              aria-label="Popular categories"
              className="mt-5 flex flex-wrap justify-center gap-2"
            >
              {popularCategories.map((c) => (
                <a
                  key={c.slug}
                  href={`#/c/${c.slug}`}
                  className="min-h-11 inline-flex items-center rounded-full border border-border bg-raised px-4 text-label font-semibold text-teal hover:bg-accent/60 hover:border-teal/40 transition-colors"
                >
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((a) => (
            <AuctionCard key={a.id} auction={a} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((a) => (
            <ListRow key={a.id} auction={a} />
          ))}
        </div>
      )}

      {(canLoadMore || refreshing) && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {refreshing && canLoadMore &&
            (view === "grid" ? <LoadingGrid count={4} /> : <ListSkeleton count={2} />)}
          {canLoadMore && !refreshing && (
            <Button
              variant="outline"
              size="lg"
              className="h-11 min-w-56 rounded-control"
              onClick={loadMore}
            >
              {freeShipping ? "Load more" : `Load more \u00b7 ${remaining} remaining`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
