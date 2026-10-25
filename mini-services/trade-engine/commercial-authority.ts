import { randomUUID } from "node:crypto";
import type { AuctionCoreIdentity, AuctionCoreStore, BidCommandResult } from "./auction-core";

export interface CommercialIdentity extends AuctionCoreIdentity {}

export type QualificationStatus =
  | "PENDING"
  | "QUALIFIED"
  | "ON_HOLD"
  | "SUSPENDED"
  | "REJECTED"
  | "EXPIRED";

function commandKey(value: unknown, prefix: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && raw.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(raw)
    ? raw
    : `${prefix}:${randomUUID()}`;
}

async function first(store: AuctionCoreStore, table: string, params: string) {
  return (await store.list(table, params))[0] ?? null;
}

export async function qualificationBundle(
  store: AuctionCoreStore,
  eventId: number,
  viewer: CommercialIdentity,
  targetUser?: string | null,
) {
  const user = viewer.admin && targetUser ? targetUser : viewer.id;
  const qualification = await first(
    store,
    "auction_bidder_qualifications",
    `filter[event_id][$eq]=${eventId}&filter[user][$eq]=${encodeURIComponent(user)}&limit=1`,
  );
  const reservations = await store.list(
    "auction_capacity_reservations",
    `filter[event_id][$eq]=${eventId}&filter[user][$eq]=${encodeURIComponent(user)}&order=-id&limit=200`,
  );
  const reserved = reservations
    .filter((r) => r.status === "ACTIVE" || r.status === "WON_OBLIGATION")
    .reduce((sum, r) => sum + Number(r.reserved_amount || 0), 0);
  const approved = Number(qualification?.approved_limit || 0);
  return {
    qualification,
    reservations,
    capacity: {
      approved,
      reserved,
      available: Math.max(0, approved - reserved),
    },
  };
}

export async function submitQualificationCommand(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    commandId?: string | null;
    eventId: number;
    targetUser: string;
    targetUsername: string;
    commandType: "REVIEW" | "APPROVE" | "HOLD" | "SUSPEND" | "REJECT" | "ADJUST_LIMIT" | "EXPIRE";
    qualificationBasis?: string | null;
    approvedLimit?: number | null;
    lotLimit?: number | null;
    accountState?: "ELIGIBLE" | "ON_HOLD" | "SUSPENDED" | null;
    riskState?: "CLEAR" | "REVIEW" | "ON_HOLD" | "SUSPENDED" | null;
    depositState?: string | null;
    depositReference?: string | null;
    depositAmount?: number | null;
    creditState?: string | null;
    creditLimit?: number | null;
    reasonCode?: string | null;
    expiresAt?: string | null;
  },
) {
  const key = commandKey(input.commandId, `qualification:${input.eventId}:${input.targetUsername}`);
  let row = await first(
    store,
    "auction_qualification_commands",
    `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  );
  if (!row) {
    const id = await store.create("auction_qualification_commands", {
      command_key: key,
      event_id: input.eventId,
      target_user: input.targetUser,
      target_username: input.targetUsername,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: actor.admin ? 1 : 0,
      command_type: input.commandType,
      qualification_basis: input.qualificationBasis ?? null,
      approved_limit: input.approvedLimit ?? null,
      lot_limit: input.lotLimit ?? null,
      account_state: input.accountState ?? null,
      risk_state: input.riskState ?? null,
      deposit_state: input.depositState ?? null,
      deposit_reference: input.depositReference ?? null,
      deposit_amount: input.depositAmount ?? null,
      credit_state: input.creditState ?? null,
      credit_limit: input.creditLimit ?? null,
      reason_code: input.reasonCode ?? null,
      expires_at: input.expiresAt ?? null,
    });
    row = id == null ? null : await store.get("auction_qualification_commands", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Qualification command could not be persisted." };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "QUALIFICATION_COMMAND_REJECTED");
    const error =
      code === "QUALIFICATION_ADMIN_REQUIRED"
        ? "Administrator authority is required to change bidder qualification."
        : code === "INVALID_APPROVED_LIMIT"
          ? "Approved bidding capacity must be zero or greater."
          : "Bidder qualification command was rejected.";
    return { ok: false, code, error, command: row };
  }
  const qualification = row.result_qualification_id
    ? await store.get("auction_bidder_qualifications", Number(row.result_qualification_id))
    : null;
  return { ok: true, command: row, qualification };
}

export async function submitQualifiedBidCommand(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    auctionId: number;
    maxAmount: number;
    commandId?: string | null;
    expectedVersion?: number | null;
  },
): Promise<BidCommandResult & { eventId?: number; capacity?: any }> {
  const key = commandKey(input.commandId, `qualified-bid:${input.auctionId}`);
  const lot = await first(
    store,
    "auction_lots",
    `filter[auction_id][$eq]=${input.auctionId}&limit=1`,
  );
  if (!lot) {
    return {
      ok: false,
      code: "AUCTION_EVENT_REQUIRED",
      error: "Vehicle auction bidding requires an auction event and bidder qualification.",
      commandKey: key,
      replayed: false,
    };
  }

  const underlyingKey = `qualified:${key}`;
  let row = await first(
    store,
    "auction_bid_capacity_commands",
    `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  );
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_bid_capacity_commands", {
      command_key: key,
      auction_command_key: underlyingKey,
      event_id: Number(lot.event_id),
      auction_id: input.auctionId,
      actor_user: actor.id,
      actor_username: actor.username,
      max_amount: Math.round(Number(input.maxAmount) * 100) / 100,
      expected_version: input.expectedVersion ?? null,
    });
    row = id == null ? null : await store.get("auction_bid_capacity_commands", id);
  }
  if (!row) {
    return {
      ok: false,
      code: "COMMAND_PERSIST_FAILED",
      error: "Qualified bid command could not be persisted.",
      commandKey: key,
      replayed,
      eventId: Number(lot.event_id),
    };
  }
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "QUALIFIED_BID_REJECTED");
    const messages: Record<string, string> = {
      BIDDER_NOT_QUALIFIED: "You are not qualified to bid in this auction event.",
      AUCTION_EVENT_MISMATCH: "This lot is not available in the selected auction event.",
      LOT_BID_LIMIT_EXCEEDED: "This bid exceeds your approved lot limit.",
      INSUFFICIENT_BID_CAPACITY: "This bid exceeds your currently available bidding capacity.",
    };
    return {
      ok: false,
      code,
      error: messages[code] ?? "The qualified bid was rejected.",
      commandKey: key,
      replayed,
      eventId: Number(lot.event_id),
      command: row,
    };
  }

  const auction = await store.get("auctions", input.auctionId);
  const capacity = await qualificationBundle(store, Number(lot.event_id), actor);
  return {
    ok: true,
    commandKey: key,
    replayed,
    amount: Number(row.result_price),
    winning: String(row.result_winner_user) === String(actor.id),
    outbid: String(row.result_winner_user) !== String(actor.id),
    auction,
    command: row,
    eventId: Number(lot.event_id),
    capacity: capacity.capacity,
  };
}
