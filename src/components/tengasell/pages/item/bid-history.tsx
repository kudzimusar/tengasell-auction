"use client";

// Tengasell bid history — Yahoo Auctions 入札履歷 style table with masked
// bidder names, automatic-bid (Zap) markers and winning status chips.

import { useMemo } from "react";
import { Gavel, Zap } from "lucide-react";
import { useAuth } from "@/lib/tengasell/auth";
import { formatDateTime, formatRelative, formatUSD } from "@/lib/tengasell/format";
import type { Bid } from "@/lib/tengasell/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";
import { maskUsername } from "./helpers";

interface BidHistoryProps {
  bids: Bid[] | null;
  loading: boolean;
}

export function BidHistory({ bids, loading }: BidHistoryProps) {
  const { user } = useAuth();
  const list = useMemo(
    () => [...(bids ?? [])].sort((a, b) => b.id - a.id),
    [bids],
  );

  if (loading && list.length === 0) {
    return (
      <div className="space-y-2 pt-4" aria-busy="true" aria-label="Loading bid history">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-control bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={<Gavel className="size-10" />}
          title="No bids yet — be the first!"
          body="Place the opening bid and let automatic bidding defend your lead."
        />
      </div>
    );
  }

  return (
    <div className="pt-4">
      <div className="rounded-card border border-border bg-raised overflow-hidden">
        <div className="max-h-96 overflow-auto ts-scrollbar">
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 z-10 bg-raised hover:bg-raised">
                <TableHead className="text-caption">Bidder</TableHead>
                <TableHead className="text-caption text-right">Amount</TableHead>
                <TableHead className="text-caption">Type</TableHead>
                <TableHead className="text-caption">Time</TableHead>
                <TableHead className="text-caption">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((b) => {
                const winning = b.status === "active";
                const mine = !!user && b.bidder_username === user.username;
                return (
                  <TableRow
                    key={b.id}
                    className={cn(mine && "bg-teal-tint/40 dark:bg-teal-tint/25")}
                  >
                    <TableCell className="text-caption font-semibold text-foreground whitespace-nowrap">
                      <span title={mine ? `You (${b.bidder_username})` : "Bidder identity protected"}>
                        {mine ? `${maskUsername(b.bidder_username)} (you)` : maskUsername(b.bidder_username)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="font-bold ts-numeric text-foreground">
                        {formatUSD(b.amount)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {b.is_auto === 1 ? (
                        <span
                          title="Automatic (proxy) bid"
                          className="inline-flex items-center gap-1 text-caption text-gold-deep font-semibold"
                        >
                          <Zap className="size-3.5" aria-hidden="true" />
                          Auto
                          <span className="sr-only">automatic bid</span>
                        </span>
                      ) : (
                        <span className="text-caption text-muted-foreground">Manual</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <time
                        title={formatDateTime(b.created_at)}
                        className="text-caption text-muted-foreground"
                      >
                        {formatRelative(b.created_at)}
                      </time>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {winning ? (
                        <span className="rounded-pill bg-teal-tint text-teal-deep dark:text-teal-soft px-2 py-0.5 text-caption font-bold">
                          Winning
                        </span>
                      ) : (
                        <span className="rounded-pill bg-muted text-muted-foreground px-2 py-0.5 text-caption font-semibold">
                          Outbid
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-caption text-muted-foreground mt-2">
        Bidder identities are partially masked for privacy. Amounts shown are the standing price
        after automatic bidding resolved.
      </p>
    </div>
  );
}
