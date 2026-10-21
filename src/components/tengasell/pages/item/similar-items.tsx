"use client";

// Tengasell similar items — 3-column grid of hot auctions from the same
// category, excluding the current listing.

import { useMemo } from "react";
import { api } from "@/lib/tengasell/api";
import { useCategories, useResource } from "@/lib/tengasell/hooks";
import type { Auction } from "@/lib/tengasell/types";
import { AuctionCard, SectionHeader } from "@/components/tengasell/ui";

export function SimilarItems({ auction }: { auction: Auction }) {
  const { categories } = useCategories();
  const similar = useResource(
    () => api.auctions({ category: auction.category, limit: 7, order: "hot" }),
    [auction.id, auction.category],
  );

  const items = useMemo(
    () => (similar.data?.items ?? []).filter((a) => a.id !== auction.id).slice(0, 6),
    [similar.data, auction.id],
  );

  const categoryName =
    categories.find((c) => c.slug === auction.category)?.name ?? auction.category;

  if (similar.loading && items.length === 0) {
    return (
      <section className="mt-10" aria-busy="true" aria-label="Loading similar items">
        <SectionHeader title="Similar items" subtitle={`More from ${categoryName}`} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-border bg-raised overflow-hidden"
            >
              <div className="aspect-[4/3] bg-muted animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse w-full" />
                <div className="h-5 bg-muted rounded animate-pulse w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="ts-similar-heading">
      <SectionHeader
        title={<span id="ts-similar-heading">Similar items</span>}
        subtitle={`More from ${categoryName}`}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {items.map((a) => (
          <AuctionCard key={a.id} auction={a} />
        ))}
      </div>
    </section>
  );
}
