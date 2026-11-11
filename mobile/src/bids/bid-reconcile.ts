// MOB-03 / CERT-02 — pure canonical post-ack bid reconciliation.
//
// Dependency-free on purpose so Node ESM tests drive production logic directly
// with deterministic TrailBase snapshots. Never replays `bid:place`.

import type { BidOutcome } from "../lib/bid-ack";
import type { BidPresentation } from "../lib/bid-copy";
import type { CanonicalBidSnapshot } from "../lib/trailbase-bids";

export interface ReconcileContext {
  auctionId: number;
  identityId: string | null;
  maxAmount: number;
  /** Highest known bid ID on this auction prior to submit, or null if unloaded. */
  beforeTopBidId: number | null;
  beforeBidCount: number;
}

export interface ReconciledBidState {
  outcome: BidOutcome;
  presentation: BidPresentation;
  auction: CanonicalBidSnapshot["auction"];
  bids?: CanonicalBidSnapshot["bids"];
}

function priceText(value: number | undefined, formatAmount: (value: number) => string): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return formatAmount(value);
}

/**
 * Resolve an unconfirmed or uncoded `BidOutcome` against canonical TrailBase
 * records. Returns `null` without calling `readSnapshot` when the outcome is
 * already authoritative (`rejected: true`, or `ok: true` with explicit position).
 */
export async function reconcileBidOutcome(
  rawOutcome: BidOutcome,
  context: ReconcileContext,
  formatAmount: (value: number) => string,
  readSnapshot: (auctionId: number) => Promise<CanonicalBidSnapshot>,
): Promise<ReconciledBidState | null> {
  const needsCanonicalResolution =
    rawOutcome.rejected !== true &&
    (!rawOutcome.ok ||
      rawOutcome.uncertain === true ||
      (rawOutcome.winning === undefined && rawOutcome.outbid !== true));

  if (!needsCanonicalResolution) {
    return null;
  }

  let snapshot: CanonicalBidSnapshot;
  try {
    snapshot = await readSnapshot(context.auctionId);
  } catch {
    return {
      outcome: { ...rawOutcome, uncertain: true, reason: rawOutcome.reason ?? "unverified" },
      presentation: {
        tone: "unknown",
        text:
          "We could not confirm this bid — it may still have reached the auction, and live records " +
          "are unreachable right now. Refresh before placing another bid.",
        reconcile: true,
      },
      auction: null,
    };
  }

  const auction = snapshot.auction;
  const bids = snapshot.bids;
  if (!auction) {
    return {
      outcome: { ...rawOutcome, uncertain: true, reason: rawOutcome.reason ?? "unverified" },
      presentation: {
        tone: "unknown",
        text:
          "We could not confirm this bid because the listing record is unavailable. " +
          "Refresh before placing another bid.",
        reconcile: true,
      },
      auction: null,
      bids,
    };
  }

  const sortedBids = [...bids].sort((a, b) => b.id - a.id);
  const topBid = sortedBids.find((b) => b.status === "active") ?? sortedBids[0];
  const minNewId = context.beforeTopBidId ?? 0;

  const committedUserBid =
    context.identityId != null
      ? sortedBids.find(
          (b) =>
            b.user === context.identityId &&
            (context.beforeTopBidId !== null
              ? b.id > minNewId
              : b.max_amount === context.maxAmount || b.amount >= context.maxAmount),
        )
      : undefined;

  if (committedUserBid) {
    const userLeads = topBid?.user === context.identityId && topBid.id >= committedUserBid.id;
    if (userLeads) {
      const amt = priceText(topBid.amount ?? auction.current_price, formatAmount);
      return {
        outcome: { ok: true, amount: topBid.amount, winning: true },
        presentation: {
          tone: "success",
          text: amt
            ? `Live auction records confirm you're the leading bidder at ${amt}.`
            : "Live auction records confirm you're the leading bidder.",
          reconcile: false,
        },
        auction,
        bids: sortedBids,
      };
    }

    const standing = priceText(auction.current_price, formatAmount);
    return {
      outcome: { ok: true, amount: auction.current_price, outbid: true },
      presentation: {
        tone: "warning",
        text: standing
          ? `Live auction records confirm your bid reached the auction (current price ${standing}), and you were outbid.`
          : "Live auction records confirm your bid reached the auction, and you were outbid.",
        reconcile: false,
      },
      auction,
      bids: sortedBids,
    };
  }

  if (rawOutcome.ok) {
    return null;
  }

  const currentStr = priceText(auction.current_price, formatAmount);
  const stillInFlight = rawOutcome.reason === "timeout" || rawOutcome.reason === "disconnected";
  return {
    outcome: { ok: false, uncertain: true, reason: rawOutcome.reason ?? "unverified" },
    presentation: {
      tone: "unknown",
      text: stillInFlight
        ? currentStr
          ? `We could not confirm this bid — it may still have reached the auction (live price ${currentStr}). Refresh and verify bid history before bidding again.`
          : "We could not confirm this bid — it may still have reached the auction. Refresh and verify bid history before bidding again."
        : currentStr
          ? `No new bid from your account appears in live records (current price ${currentStr}). Verify bid history before placing another bid.`
          : "No new bid from your account appears in live records. Verify bid history before placing another bid.",
      reconcile: true,
    },
    auction,
    bids: sortedBids,
  };
}
