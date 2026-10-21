"use client";

// Tengasell seller feedback section — the anchor target for the seller
// card's "View feedback" action. Shows the ratee's received ratings.

import { MessageSquareQuote } from "lucide-react";
import { formatRelative } from "@/lib/tengasell/format";
import { useRatings } from "@/lib/tengasell/hooks";
import { EmptyState, RatingStars, SectionHeader } from "@/components/tengasell/ui";

export function SellerFeedback({ username }: { username: string }) {
  const ratings = useRatings(username);
  const list = ratings.data ?? [];

  return (
    <section
      id="seller-feedback"
      aria-labelledby="ts-feedback-heading"
      className="mt-10 scroll-mt-28"
    >
      <SectionHeader
        title={<span id="ts-feedback-heading">Seller feedback</span>}
        subtitle={`Ratings received by @${username}`}
      />
      {ratings.loading && list.length === 0 ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading feedback">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-card border border-border p-4 space-y-2">
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MessageSquareQuote className="size-10" />}
          title="No feedback yet"
          body={`@${username} hasn't received ratings on completed orders yet.`}
        />
      ) : (
        <ul className="max-h-96 overflow-y-auto ts-scrollbar space-y-3 pe-1">
          {list.map((r) => (
            <li key={r.id} className="rounded-card border border-border bg-raised p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RatingStars value={r.score} showCount={false} />
                <span className="rounded-pill bg-muted text-muted-foreground px-2 py-0.5 text-caption font-semibold">
                  {r.direction === "as_seller" ? "as seller" : "as buyer"}
                </span>
                <time
                  title={r.created_at}
                  className="text-caption text-muted-foreground ms-auto"
                >
                  {formatRelative(r.created_at)}
                </time>
              </div>
              {r.comment && (
                <p className="text-body text-foreground mt-2 whitespace-pre-line">
                  {r.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
