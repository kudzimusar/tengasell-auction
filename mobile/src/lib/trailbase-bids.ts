// MOB-03 / CERT-02 — canonical read-only TrailBase bid queries.
//
// Separated from src/lib/trailbase.ts so PR #7 (marketplace browse/detail) and
// PR #9 (live bidding reconciliation) remain cleanly scoped while keeping raw
// REST endpoints out of UI screens (verified by SOCK-13).

import { fetchAuction, publicRequest } from "./trailbase";
import type { Auction, Bid } from "./types";

interface RecordsResponse<T> {
  records?: T[];
}

export interface CanonicalBidSnapshot {
  auction: Auction | null;
  bids: Bid[];
}

/** Read recent canonical bids for an auction directly from TrailBase (world-readable). */
export async function fetchAuctionBids(auctionId: number, limit = 20): Promise<Bid[]> {
  const data = await publicRequest<RecordsResponse<Bid>>("/api/records/v1/bids", {
    "filter[auction_id][$eq]": auctionId,
    order: "-id",
    limit,
  });
  return data.records ?? [];
}

/** Fetch current canonical auction and recent bids in parallel without writes. */
export async function readCanonicalBidSnapshot(auctionId: number): Promise<CanonicalBidSnapshot> {
  const [auction, bids] = await Promise.all([
    fetchAuction(auctionId),
    fetchAuctionBids(auctionId, 20),
  ]);
  return { auction, bids };
}
