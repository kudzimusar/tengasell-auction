import type { AuthErrorCode, Identity } from "./auth";

export type BidAckCode =
  | AuthErrorCode
  | "PROFILE_MISSING"
  | "INVALID_AUCTION"
  | "AUCTION_NOT_FOUND"
  | "AUCTION_LOOKUP_FAILED"
  | "AUCTION_NOT_LIVE"
  | "AUCTION_ENDED"
  | "SELF_BID"
  | "INVALID_AMOUNT"
  | "BID_LEDGER_UNAVAILABLE"
  | "BELOW_START_PRICE"
  | "BELOW_MIN_BID"
  | "WRITE_REJECTED"
  | "COMMIT_UNCERTAIN"
  | "INVALID_REQUEST_ID"
  | "IDEMPOTENCY_CONFLICT";

export interface BidOutcome {
  ok: boolean;
  committed?: boolean;
  stage?: "pre_commit" | "committed" | "commit_uncertain";
  rejected?: boolean;
  uncertain?: boolean;
  reason?: "timeout" | "disconnected" | "malformed" | "unverified";
  code?: BidAckCode | string;
  error?: string;
  bidId?: number;
  amount?: number;
  winning?: boolean;
  outbid?: boolean;
  auction?: any;
  clientRequestId?: string;
  idempotentReplay?: boolean;
  warnings?: string[];
}

export function preCommitError(code: BidAckCode | string, error: string): BidOutcome {
  return {
    ok: false,
    committed: false,
    stage: "pre_commit",
    rejected: true,
    code,
    error,
  };
}

export function uncertainBidOutcome(code: BidAckCode | string, error: string): BidOutcome {
  return {
    ok: false,
    uncertain: true,
    stage: "commit_uncertain",
    reason: "unverified",
    code,
    error,
  };
}

export function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().replace(/\.\d+Z$/, "Z");
}

export function isoPlus(ms: number, nowMs = Date.now()): string {
  return new Date(nowMs + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bidIncrement(price: number): number {
  if (price < 50) return 1;
  if (price < 500) return 2;
  if (price < 1000) return 5;
  if (price < 5000) return 10;
  return 25;
}

export interface BiddingStore {
  getAuction: (auctionId: number) => Promise<
    | { ok: true; row: any }
    | { ok: false; notFound: boolean; error: string }
  >;
  listBids: (auctionId: number) => Promise<
    | { ok: true; rows: any[] }
    | { ok: false; error: string }
  >;
  createBid: (row: Record<string, unknown>) => Promise<
    | { status: "created"; id: number }
    | { status: "rejected"; statusCode: number }
    | { status: "uncertain"; error: string }
  >;
  patchBid: (bidId: number, patch: Record<string, unknown>) => Promise<boolean>;
  patchAuction: (auctionId: number, patch: Record<string, unknown>) => Promise<boolean>;
  extendLiveRoom: (liveSessionId: number) => Promise<{ session: any | null; warning?: string }>;
  antiSnipe: (auctionId: number) => Promise<{ auction: any | null; warning?: string }>;
  notifyBestEffort: (
    userId: string,
    type: string,
    title: string,
    body: string,
    link: string,
  ) => Promise<boolean>;
  notifyWatchersBestEffort: (
    auction: any,
    bidder: Identity,
    price: number,
  ) => Promise<boolean>;
  commsOutbidBestEffort: (input: {
    userId: string;
    auctionTitle: string;
    amount: number;
    bidderLabel: string;
    auctionId: number;
  }) => void;
  auditBestEffort: (
    userId: string,
    action: string,
    entity: string,
    entityId: number,
    source: string,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  emitRoomUpdate: (session: any) => void;
  emitAuctionUpdate: (auction: any) => void;
}

interface IdempotencyEntry {
  state: "in_flight" | "settled";
  maxAmount: number;
  startedAtIso: string;
  expiresAtMs: number;
  promise?: Promise<BidOutcome>;
  outcome?: BidOutcome;
}

/**
 * Serializes commercial bid mutations per auction inside the engine so concurrent
 * proxy-bid evaluations cannot interleave or supersede each other out of order.
 */
export class AuctionLockMap {
  private readonly tails = new Map<number, Promise<void>>();

  async run<T>(auctionId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(auctionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => current, () => current);
    this.tails.set(auctionId, tail);

    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(auctionId) === tail) {
        this.tails.delete(auctionId);
      }
    }
  }
}

export class BidService {
  private readonly locks = new AuctionLockMap();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly idempotencyTtlMs: number;
  private readonly maxIdempotencyEntries: number;
  private readonly nowMsFn: () => number;

  constructor(
    private readonly store: BiddingStore,
    opts?: {
      idempotencyTtlMs?: number;
      maxIdempotencyEntries?: number;
      nowMs?: () => number;
    },
  ) {
    this.idempotencyTtlMs = opts?.idempotencyTtlMs ?? 30 * 60_000;
    this.maxIdempotencyEntries = opts?.maxIdempotencyEntries ?? 4096;
    this.nowMsFn = opts?.nowMs ?? (() => Date.now());
  }

  private pruneIdempotency(): void {
    const nowMs = this.nowMsFn();
    for (const [key, entry] of this.idempotency.entries()) {
      if (entry.state === "settled" && entry.expiresAtMs <= nowMs) {
        this.idempotency.delete(key);
      }
    }
    while (this.idempotency.size >= this.maxIdempotencyEntries) {
      const oldest = this.idempotency.keys().next().value;
      if (!oldest) break;
      this.idempotency.delete(oldest);
    }
  }

  private recordIdempotency(key: string, entry: IdempotencyEntry): void {
    this.pruneIdempotency();
    this.idempotency.delete(key);
    this.idempotency.set(key, entry);
  }

  async handleBidPlace(input: {
    user: Identity;
    auctionId: unknown;
    maxAmount: unknown;
    clientRequestId?: unknown;
  }): Promise<BidOutcome> {
    const auctionId = Number(input.auctionId);
    if (!Number.isInteger(auctionId) || auctionId <= 0) {
      return preCommitError("INVALID_AUCTION", "Invalid auction.");
    }

    let clientRequestId: string | undefined;
    if (input.clientRequestId !== undefined && input.clientRequestId !== null) {
      if (typeof input.clientRequestId !== "string") {
        return preCommitError("INVALID_REQUEST_ID", "Invalid clientRequestId.");
      }
      const trimmed = input.clientRequestId.trim();
      if (!trimmed || trimmed.length > 128) {
        return preCommitError("INVALID_REQUEST_ID", "Invalid clientRequestId.");
      }
      clientRequestId = trimmed;
    }

    const rawMax = Number(input.maxAmount);
    const maxAmount = Number.isFinite(rawMax) ? round2(rawMax) : NaN;
    const idemKey = clientRequestId ? `${input.user.id || input.user.username}:${auctionId}:${clientRequestId}` : null;

    return this.locks.run(auctionId, async () => {
      if (idemKey) {
        const existing = this.idempotency.get(idemKey);
        if (existing && existing.expiresAtMs > this.nowMsFn()) {
          if (Number.isFinite(maxAmount) && existing.maxAmount !== maxAmount) {
            return preCommitError(
              "IDEMPOTENCY_CONFLICT",
              "Conflicting retry for the same request id.",
            );
          }
          if (existing.state === "in_flight" && existing.promise) {
            return await existing.promise;
          }
          if (existing.state === "settled" && existing.outcome) {
            const settled = existing.outcome;
            if (settled.ok && settled.committed) {
              const latest = await this.store.getAuction(auctionId).catch(() => null);
              return {
                ...settled,
                ...(latest && latest.ok ? { auction: latest.row } : {}),
                idempotentReplay: true,
              };
            }
            if (settled.uncertain) {
              const reconciled = await this.tryReconcileUncertain(
                input.user,
                auctionId,
                existing.maxAmount,
                existing.startedAtIso,
                clientRequestId!,
              );
              if (reconciled) {
                this.recordIdempotency(idemKey, {
                  state: "settled",
                  maxAmount: existing.maxAmount,
                  startedAtIso: existing.startedAtIso,
                  expiresAtMs: this.nowMsFn() + this.idempotencyTtlMs,
                  outcome: reconciled,
                });
                return reconciled;
              }
              return settled;
            }
          }
        }
      }

      const startedAtIso = nowIso(this.nowMsFn());
      const execPromise = this.executeSingleBid(
        input.user,
        auctionId,
        maxAmount,
        clientRequestId,
      );

      if (idemKey && Number.isFinite(maxAmount) && maxAmount > 0 && input.user.id) {
        this.recordIdempotency(idemKey, {
          state: "in_flight",
          maxAmount,
          startedAtIso,
          expiresAtMs: this.nowMsFn() + this.idempotencyTtlMs,
          promise: execPromise,
        });
      }

      const outcome = await execPromise;

      if (idemKey && Number.isFinite(maxAmount) && maxAmount > 0 && input.user.id) {
        if (outcome.committed || outcome.uncertain) {
          this.recordIdempotency(idemKey, {
            state: "settled",
            maxAmount,
            startedAtIso,
            expiresAtMs: this.nowMsFn() + this.idempotencyTtlMs,
            outcome,
          });
        } else {
          // Do not cache transient pre-commit validation rejections across future bids,
          // unless they succeeded or had an uncertain commit outcome.
          this.idempotency.delete(idemKey);
        }
      }

      return outcome;
    });
  }

  private async tryReconcileUncertain(
    user: Identity,
    auctionId: number,
    maxAmount: number,
    startedAtIso: string,
    clientRequestId: string,
  ): Promise<BidOutcome | null> {
    const ledger = await this.store.listBids(auctionId).catch(() => null);
    if (!ledger || !ledger.ok) return null;
    const match = ledger.rows.find(
      (b: any) =>
        b.user === user.id &&
        Number(b.max_amount) === maxAmount &&
        typeof b.created_at === "string" &&
        b.created_at >= startedAtIso,
    );
    if (!match) return null;
    const auctionRes = await this.store.getAuction(auctionId).catch(() => null);
    return {
      ok: true,
      committed: true,
      stage: "committed",
      bidId: Number(match.id),
      amount: Number(match.amount),
      winning: match.status === "active",
      ...(match.status !== "active" ? { outbid: true } : {}),
      ...(auctionRes && auctionRes.ok ? { auction: auctionRes.row } : {}),
      clientRequestId,
      idempotentReplay: true,
    };
  }

  private async executeSingleBid(
    me: Identity,
    auctionId: number,
    maxAmount: number,
    clientRequestId?: string,
  ): Promise<BidOutcome> {
    if (!me.id) {
      return preCommitError("PROFILE_MISSING", "Account profile missing — reload and retry.");
    }

    let auctionRes;
    try {
      auctionRes = await this.store.getAuction(auctionId);
    } catch {
      return preCommitError(
        "AUCTION_LOOKUP_FAILED",
        "Could not verify auction state — please retry.",
      );
    }
    if (!auctionRes.ok) {
      return auctionRes.notFound
        ? preCommitError("AUCTION_NOT_FOUND", "Auction not found.")
        : preCommitError(
            "AUCTION_LOOKUP_FAILED",
            "Could not verify auction state — please retry.",
          );
    }

    const auction = auctionRes.row;
    if (auction.status !== "live") {
      return preCommitError("AUCTION_NOT_LIVE", "This auction is no longer live.");
    }
    const endsMs = Date.parse(auction.ends_at) - this.nowMsFn();
    if (!Number.isFinite(endsMs) || endsMs <= 0) {
      return preCommitError("AUCTION_ENDED", "This auction has ended.");
    }
    if (auction.user === me.id) {
      return preCommitError("SELF_BID", "You cannot bid on your own auction.");
    }
    if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
      return preCommitError("INVALID_AMOUNT", "Enter a valid maximum bid.");
    }

    let ledger;
    try {
      ledger = await this.store.listBids(auctionId);
    } catch {
      return preCommitError(
        "BID_LEDGER_UNAVAILABLE",
        "Could not verify current bids — please retry.",
      );
    }
    if (!ledger.ok) {
      return preCommitError(
        "BID_LEDGER_UNAVAILABLE",
        "Could not verify current bids — please retry.",
      );
    }

    const active = ledger.rows.find((b: any) => b.status === "active");
    const inc = bidIncrement(active ? Number(active.amount) : Number(auction.start_price));

    let committedPrice: number;
    let winning: boolean;
    let outbid = false;
    let bidRowToInsert: Record<string, unknown>;
    let prevActiveToSupersede: any = null;
    const createdAt = nowIso(this.nowMsFn());

    if (!active) {
      const startPrice = Number(auction.start_price);
      if (maxAmount < startPrice) {
        return preCommitError("BELOW_START_PRICE", `The opening bid is US$${startPrice}.`);
      }
      committedPrice = startPrice;
      winning = true;
      bidRowToInsert = {
        auction_id: auctionId,
        user: me.id,
        bidder_username: me.username,
        amount: startPrice,
        max_amount: maxAmount,
        is_auto: 1,
        status: "active",
        created_at: createdAt,
      };
    } else {
      const min = round2(Number(active.amount) + inc);
      if (maxAmount < min) {
        return preCommitError(
          "BELOW_MIN_BID",
          `Your maximum bid is below the minimum next bid of US$${min}.`,
        );
      }

      prevActiveToSupersede = active;
      if (maxAmount > Number(active.max_amount)) {
        committedPrice = round2(Math.min(maxAmount, Number(active.max_amount) + inc));
        winning = true;
        bidRowToInsert = {
          auction_id: auctionId,
          user: me.id,
          bidder_username: me.username,
          amount: committedPrice,
          max_amount: maxAmount,
          is_auto: 1,
          status: "active",
          created_at: createdAt,
        };
      } else {
        committedPrice = round2(Math.min(Number(active.max_amount), maxAmount + inc));
        winning = false;
        outbid = true;
        bidRowToInsert = {
          auction_id: auctionId,
          user: active.user,
          bidder_username: active.bidder_username,
          amount: committedPrice,
          max_amount: Number(active.max_amount),
          is_auto: 1,
          status: "active",
          created_at: createdAt,
        };
      }
    }

    // Create the new active bid row BEFORE superseding the previous bid so a clean
    // pre-insert HTTP rejection never leaves an auction without an active lead bid.
    let createResult;
    try {
      createResult = await this.store.createBid(bidRowToInsert);
    } catch (err) {
      return uncertainBidOutcome(
        "COMMIT_UNCERTAIN",
        `Bid submission status could not be confirmed (${(err as Error).message || "transport error"}).`,
      );
    }

    if (createResult.status === "rejected") {
      return preCommitError("WRITE_REJECTED", "Could not record your bid — please retry.");
    }
    if (createResult.status === "uncertain") {
      return uncertainBidOutcome(
        "COMMIT_UNCERTAIN",
        "Bid submission status could not be confirmed; check auction state before retrying.",
      );
    }

    // ── COMMIT POINT CROSSED ───────────────────────────────────────────
    // The bid row exists in TrailBase. Nothing after this point may report ok: false.
    const bidId = createResult.id;
    const warnings: string[] = [];
    const nextBidCount = !prevActiveToSupersede ? 1 : Number(auction.bid_count ?? 0) + 1;

    if (prevActiveToSupersede) {
      let superseded = false;
      try {
        superseded = await this.store.patchBid(Number(prevActiveToSupersede.id), {
          status: "superseded",
        });
        if (!superseded) {
          superseded = await this.store.patchBid(Number(prevActiveToSupersede.id), {
            status: "superseded",
          });
        }
      } catch {
        superseded = false;
      }
      if (!superseded) {
        warnings.push("supersede_failed");
        console.error(
          `[bid:place:post_commit] failed to supersede bid ${prevActiveToSupersede.id} after committing bid ${bidId}`,
        );
      }
    }

    let summaryUpdated = false;
    const auctionPatch = {
      current_price: committedPrice,
      bid_count: nextBidCount,
      updated_at: nowIso(this.nowMsFn()),
    };
    try {
      summaryUpdated = await this.store.patchAuction(auctionId, auctionPatch);
      if (!summaryUpdated) {
        summaryUpdated = await this.store.patchAuction(auctionId, auctionPatch);
      }
    } catch {
      summaryUpdated = false;
    }
    if (!summaryUpdated) {
      warnings.push("auction_summary_sync_failed");
      console.error(
        `[bid:place:post_commit] failed to sync auction ${auctionId} summary after committing bid ${bidId}`,
      );
    }

    let finalAuction: any = {
      ...auction,
      current_price: committedPrice,
      bid_count: nextBidCount,
      updated_at: auctionPatch.updated_at,
    };

    if (auction.live_session_id != null) {
      try {
        const roomRes = await this.store.extendLiveRoom(Number(auction.live_session_id));
        if (roomRes.warning) warnings.push(roomRes.warning);
        if (roomRes.session) this.store.emitRoomUpdate(roomRes.session);
      } catch (err) {
        warnings.push("room_extend_failed");
        console.error("[bid:place:post_commit] live room extension failed:", err);
      }
      try {
        const refreshed = await this.store.getAuction(auctionId);
        if (refreshed.ok) finalAuction = refreshed.row;
        else warnings.push("auction_read_failed");
      } catch {
        warnings.push("auction_read_failed");
      }
    } else {
      try {
        const snipeRes = await this.store.antiSnipe(auctionId);
        if (snipeRes.warning) warnings.push(snipeRes.warning);
        if (snipeRes.auction) finalAuction = snipeRes.auction;
      } catch (err) {
        warnings.push("anti_snipe_failed");
        console.error("[bid:place:post_commit] anti-snipe failed:", err);
      }
    }

    try {
      this.store.emitAuctionUpdate(finalAuction);
    } catch (err) {
      console.error("[bid:place:post_commit] emit auction:update failed:", err);
    }

    // Notifications + TUCS fan-out are strictly non-fatal post-commit work.
    if (!prevActiveToSupersede) {
      const ok = await this.store
        .notifyWatchersBestEffort(finalAuction, me, committedPrice)
        .catch(() => false);
      if (!ok) warnings.push("notify_failed");
    } else if (winning) {
      const ok1 = await this.store
        .notifyBestEffort(
          String(prevActiveToSupersede.user),
          "outbid",
          "You were outbid",
          `${me.username} placed a higher bid on ${auction.title}.`,
          `#/item/${auctionId}`,
        )
        .catch(() => false);
      if (!ok1) warnings.push("notify_failed");
      if (prevActiveToSupersede.bidder_username) {
        try {
          this.store.commsOutbidBestEffort({
            userId: String(prevActiveToSupersede.bidder_username),
            auctionTitle: auction.title,
            amount: committedPrice,
            bidderLabel: me.username,
            auctionId,
          });
        } catch {
          /* fire-and-forget */
        }
      }
      const ok2 = await this.store
        .notifyWatchersBestEffort(finalAuction, me, committedPrice)
        .catch(() => false);
      if (!ok2 && !warnings.includes("notify_failed")) warnings.push("notify_failed");
    } else {
      const ok1 = await this.store
        .notifyBestEffort(
          me.id,
          "outbid",
          "You were outbid",
          `Automatic bidding for ${prevActiveToSupersede.bidder_username} exceeded your maximum on ${auction.title}.`,
          `#/item/${auctionId}`,
        )
        .catch(() => false);
      if (!ok1) warnings.push("notify_failed");
      try {
        this.store.commsOutbidBestEffort({
          userId: me.username,
          auctionTitle: auction.title,
          amount: committedPrice,
          bidderLabel: String(prevActiveToSupersede.bidder_username ?? ""),
          auctionId,
        });
      } catch {
        /* fire-and-forget */
      }
    }

    const audited = await this.store
      .auditBestEffort(me.id, "bid:place", "auctions", auctionId, "web", {
        maxAmount,
        amount: committedPrice,
        bidId,
        ...(clientRequestId ? { clientRequestId } : {}),
      })
      .catch(() => false);
    if (!audited) warnings.push("audit_failed");

    return {
      ok: true,
      committed: true,
      stage: "committed",
      bidId,
      amount: committedPrice,
      winning,
      ...(outbid ? { outbid: true } : {}),
      auction: finalAuction,
      ...(clientRequestId ? { clientRequestId } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
