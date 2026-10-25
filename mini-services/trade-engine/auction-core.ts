// TENGASELL-AUCTION-IMP-02 — transactional command boundary for the
// canonical TrailBase + trade-engine auction authority.
//
// Correctness is enforced by the SQLite migration trigger, not by process-local
// mutexes. This module is the transport adapter: it submits idempotent commands,
// reads the committed result, and drains the durable outbox after commit.

import { randomUUID } from "node:crypto";

export interface AuctionCoreIdentity {
  id: string;
  username: string;
  admin?: boolean;
}

export interface AuctionCoreStore {
  create(table: string, row: unknown): Promise<number | null>;
  get(table: string, id: number | string): Promise<any | null>;
  list(table: string, params: string): Promise<any[]>;
  update(table: string, id: number | string, patch: unknown): Promise<boolean>;
}

export interface BidCommandResult {
  ok: boolean;
  error?: string;
  code?: string;
  commandKey: string;
  replayed: boolean;
  amount?: number;
  winning?: boolean;
  outbid?: boolean;
  auction?: any;
  session?: any;
  command?: any;
}

export interface FinalizationResult {
  ok: boolean;
  error?: string;
  code?: string;
  commandKey: string;
  replayed: boolean;
  outcome?: "sold" | "unsold";
  orderId?: number | null;
  price?: number | null;
  auction?: any;
  order?: any;
  command?: any;
}

export interface FinalizationInput {
  commandKey?: string | null;
  auctionId: number;
  source:
    | "TIMED_SWEEP"
    | "LIVE_HAMMER"
    | "MANUAL_HAMMER"
    | "MANUAL_PASS"
    | "OFFER_ACCEPT"
    | "OFFER_COUNTER_ACCEPT"
    | "BUY_NOW";
  requestedOutcome: "AUTO" | "SOLD" | "UNSOLD";
  buyer?: { id: string; username: string } | null;
  price?: number | null;
  address?: string | null;
  expectedVersion?: number | null;
}

export interface AuctionOutboxEnvelope {
  id: number;
  event_key: string;
  auction_id: number;
  command_id: number | null;
  event_type: "AUCTION_BID_ACCEPTED" | "AUCTION_SOLD" | "AUCTION_ENDED_UNSOLD" | string;
  payload: string;
  occurred_at: string;
  published_at?: string | null;
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function key(value: unknown, prefix: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw && raw.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(raw)) return raw;
  return `${prefix}:${randomUUID()}`;
}

function sameNumber(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return Number(a) === Number(b);
}

async function findByCommandKey(
  store: AuctionCoreStore,
  table: "auction_commands" | "auction_finalization_commands",
  commandKey: string,
): Promise<any | null> {
  const rows = await store.list(
    table,
    `filter[command_key][$eq]=${encodeURIComponent(commandKey)}&limit=1`,
  );
  return rows[0] ?? null;
}

function rejectionMessage(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    AUCTION_NOT_FOUND: "Auction not found.",
    AUCTION_NOT_LIVE: "This auction is no longer live.",
    AUCTION_ENDED: "This auction has ended.",
    SELLER_CANNOT_BID: "You cannot bid on your own auction.",
    INVALID_MAX_AMOUNT: "Enter a valid maximum bid.",
    STALE_AUCTION_VERSION: "The auction changed before your command committed. Refresh and retry.",
    MAX_NOT_RAISED: "Your new maximum must be higher than your standing maximum.",
    MAX_BELOW_OPENING: "Your maximum is below the opening bid.",
    MAX_BELOW_MINIMUM: "Your maximum is below the current minimum bid.",
    TIMED_FINALIZATION_NOT_DUE: "The timed auction is not due to close.",
    LIVE_HAMMER_NOT_DUE: "The live hammer clock has not elapsed.",
    SOLD_REQUIRES_BUYER: "A sold outcome requires a buyer and final price.",
    RETRACTION_REASON_REQUIRED: "Give a reason of at least 10 characters.",
    RETRACTION_TARGET_NOT_ACTIVE: "Only the current leading bid can be retracted.",
    RETRACTION_FORBIDDEN: "You can only retract your own leading bid.",
    RETRACTION_WINDOW_ELAPSED: "The 60-minute retraction window has elapsed.",
    IDEMPOTENCY_KEY_REUSE: "That command id was already used for a different request.",
  };
  return messages[String(code ?? "")] ?? "The auction command was rejected.";
}

export async function submitBidCommand(
  store: AuctionCoreStore,
  me: AuctionCoreIdentity,
  input: {
    auctionId: number;
    maxAmount: number;
    commandKey?: string | null;
    expectedVersion?: number | null;
  },
): Promise<BidCommandResult> {
  const commandKey = key(input.commandKey, `bid:${input.auctionId}`);
  const maxAmount = Math.round(Number(input.maxAmount) * 100) / 100;
  if (!Number.isFinite(input.auctionId) || input.auctionId <= 0 || !Number.isFinite(maxAmount)) {
    return {
      ok: false,
      code: "INVALID_COMMAND",
      error: "Invalid auction bid command.",
      commandKey,
      replayed: false,
    };
  }

  let existing = await findByCommandKey(store, "auction_commands", commandKey);
  let replayed = existing != null;
  if