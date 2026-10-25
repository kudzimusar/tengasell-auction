import { randomUUID } from "node:crypto";
import type { AuctionCoreIdentity, AuctionCoreStore, BidCommandResult } from "./auction-core";
import { hasOperationCapability } from "./operation-authority";

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
  const authorized =
    actor.admin ||
    await hasOperationCapability(store, actor, "QUALIFICATION_REVIEWER", input.eventId);
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
      actor_admin: authorized ? 1 : 0,
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


export async function settlementBundle(
  store: AuctionCoreStore,
  viewer: CommercialIdentity,
  settlementId: number,
) {
  const settlement = await store.get("auction_settlements", settlementId);
  if (!settlement) return { ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." };
  const participant =
    String(settlement.buyer_user) === String(viewer.id) ||
    String(settlement.seller_user) === String(viewer.id);
  const eventId = settlement.event_id == null ? null : Number(settlement.event_id);
  const operator =
    viewer.admin ||
    await hasOperationCapability(store, viewer, "FINANCE_OPERATOR", eventId) ||
    await hasOperationCapability(store, viewer, "RELEASE_OPERATOR", eventId) ||
    await hasOperationCapability(store, viewer, "TRANSPORT_OPERATOR", eventId);
  if (!participant && !operator) {
    return { ok: false, code: "SETTLEMENT_FORBIDDEN", error: "You cannot view this settlement." };
  }
  const [lines, documents, releaseRows, transport, handovers, events] = await Promise.all([
    store.list("auction_invoice_lines", `filter[settlement_id][$eq]=${settlementId}&order=id&limit=100`),
    store.list("auction_transfer_documents", `filter[settlement_id][$eq]=${settlementId}&order=id&limit=100`),
    store.list("auction_release_authorizations", `filter[settlement_id][$eq]=${settlementId}&order=-id&limit=10`),
    store.list("auction_transport_bookings", `filter[settlement_id][$eq]=${settlementId}&order=-id&limit=20`),
    store.list("auction_handovers", `filter[settlement_id][$eq]=${settlementId}&order=-id&limit=10`),
    store.list("auction_settlement_events", `filter[settlement_id][$eq]=${settlementId}&order=id&limit=500`),
  ]);
  return {
    ok: true,
    settlement,
    invoiceLines: lines,
    transferDocuments: documents,
    releaseAuthorization: releaseRows[0] ?? null,
    transport,
    handover: handovers[0] ?? null,
    events,
  };
}

export async function settlementForOrder(
  store: AuctionCoreStore,
  viewer: CommercialIdentity,
  orderId: number,
) {
  const settlement = await first(
    store,
    "auction_settlements",
    `filter[order_id][$eq]=${orderId}&limit=1`,
  );
  if (!settlement) return { ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." };
  return settlementBundle(store, viewer, Number(settlement.id));
}

export async function submitFinanceCallback(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    idempotencyKey?: string | null;
    settlementId: number;
    orderId: number;
    eventType:
      | "INVOICE_ACKNOWLEDGED"
      | "PAYMENT_CAPTURED"
      | "PAYMENT_FAILED"
      | "PAYMENT_REFUNDED"
      | "DISPUTE_OPENED"
      | "DISPUTE_RESOLVED"
      | "SELLER_PAYOUT_STATUS";
    amount?: number | null;
    currency?: string | null;
    sourceReference?: string | null;
    payoutState?: string | null;
  },
) {
  const settlement = await store.get("auction_settlements", input.settlementId);
  const eventId = settlement?.event_id == null ? null : Number(settlement.event_id);
  const authorized =
    actor.admin ||
    await hasOperationCapability(store, actor, "FINANCE_OPERATOR", eventId);
  const key = commandKey(input.idempotencyKey, `finance:${input.settlementId}:${input.eventType}`);
  let row = await first(
    store,
    "auction_finance_callbacks",
    `filter[idempotency_key][$eq]=${encodeURIComponent(key)}&limit=1`,
  );
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_finance_callbacks", {
      idempotency_key: key,
      settlement_id: input.settlementId,
      order_id: input.orderId,
      event_type: input.eventType,
      amount: input.amount ?? null,
      currency: input.currency ?? "USD",
      source_reference: input.sourceReference ?? null,
      payout_state: input.payoutState ?? null,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: authorized ? 1 : 0,
    });
    row = id == null ? null : await store.get("auction_finance_callbacks", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Finance callback could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "FINANCE_CALLBACK_REJECTED");
    return {
      ok: false,
      code,
      error: code === "FINANCE_AUTHORITY_REQUIRED"
        ? "Finance authority is required for settlement accounting updates."
        : "Finance callback was rejected.",
      replayed,
      command: row,
    };
  }
  return {
    ok: true,
    replayed,
    command: row,
    bundle: await settlementBundle(store, actor, input.settlementId),
  };
}

export async function submitTransferCommand(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    commandId?: string | null;
    settlementId: number;
    commandType:
      | "START"
      | "REQUIRE_DOCUMENT"
      | "SUBMIT_DOCUMENT"
      | "ACCEPT_DOCUMENT"
      | "REJECT_DOCUMENT"
      | "MARK_READY"
      | "MARK_EXTERNAL_PENDING"
      | "EVIDENCE_RECEIVED"
      | "COMPLETE"
      | "HOLD";
    documentType?: string | null;
    documentRef?: string | null;
    externalProcess?: boolean;
    reason?: string | null;
  },
) {
  const settlement = await store.get("auction_settlements", input.settlementId);
  const eventId = settlement?.event_id == null ? null : Number(settlement.event_id);
  const authorized =
    actor.admin ||
    await hasOperationCapability(store, actor, "RELEASE_OPERATOR", eventId);
  const key = commandKey(input.commandId, `transfer:${input.settlementId}:${input.commandType}`);
  let row = await first(store, "auction_transfer_commands", `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`);
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_transfer_commands", {
      command_key: key,
      settlement_id: input.settlementId,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: authorized ? 1 : 0,
      command_type: input.commandType,
      document_type: input.documentType ?? null,
      document_ref: input.documentRef ?? null,
      external_process: input.externalProcess ? 1 : 0,
      reason: input.reason ?? null,
    });
    row = id == null ? null : await store.get("auction_transfer_commands", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Transfer command could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "TRANSFER_COMMAND_REJECTED");
    return {
      ok: false,
      code,
      error: code === "TRANSFER_AUTHORITY_REQUIRED"
        ? "Transfer review authority is required."
        : "Transfer command was rejected.",
      replayed,
      command: row,
    };
  }
  return { ok: true, replayed, command: row, bundle: await settlementBundle(store, actor, input.settlementId) };
}

export async function submitReleaseCommand(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    commandId?: string | null;
    settlementId: number;
    collectorType: "BUYER" | "REPRESENTATIVE" | "TRANSPORTER";
    collectorUser?: string | null;
    collectorName: string;
    collectorReference?: string | null;
    conditions?: string | null;
  },
) {
  const settlement = await store.get("auction_settlements", input.settlementId);
  const eventId = settlement?.event_id == null ? null : Number(settlement.event_id);
  const authorized =
    actor.admin ||
    await hasOperationCapability(store, actor, "RELEASE_OPERATOR", eventId);
  const key = commandKey(input.commandId, `release:${input.settlementId}`);
  let row = await first(store, "auction_release_commands", `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`);
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_release_commands", {
      command_key: key,
      settlement_id: input.settlementId,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: authorized ? 1 : 0,
      collector_type: input.collectorType,
      collector_user: input.collectorUser ?? null,
      collector_name: input.collectorName.trim().slice(0, 120),
      collector_reference: input.collectorReference ?? null,
      conditions: input.conditions ?? "",
    });
    row = id == null ? null : await store.get("auction_release_commands", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Release command could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "RELEASE_COMMAND_REJECTED");
    const messages: Record<string, string> = {
      RELEASE_AUTHORITY_REQUIRED: "Release authority is required.",
      PAYMENT_NOT_SETTLED: "Vehicle release is blocked until Finance confirms payment settlement.",
      TRANSFER_NOT_COMPLETE: "Vehicle release is blocked until required transfer evidence is complete.",
      ACTIVE_DISPUTE: "Vehicle release is blocked while a dispute is open.",
      COLLECTOR_REQUIRED: "Identify the buyer, authorized representative, or transporter collecting the vehicle.",
    };
    return { ok: false, code, error: messages[code] ?? "Release command was rejected.", replayed, command: row };
  }
  return { ok: true, replayed, command: row, bundle: await settlementBundle(store, actor, input.settlementId) };
}

export async function requestTransport(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: {
    requestId?: string | null;
    settlementId: number;
    transporter: string;
    transporterReference?: string | null;
    pickupLocation: string;
    destination: string;
    scheduledAt?: string | null;
  },
) {
  const settlement = await store.get("auction_settlements", input.settlementId);
  if (!settlement) return { ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." };
  const buyer = String(settlement.buyer_user) === String(actor.id);
  const eventId = settlement.event_id == null ? null : Number(settlement.event_id);
  const transportOperator =
    actor.admin ||
    await hasOperationCapability(store, actor, "TRANSPORT_OPERATOR", eventId);
  if (!buyer && !transportOperator)
    return { ok: false, code: "TRANSPORT_FORBIDDEN", error: "Only the buyer or an authorized transport operator can request transport." };
  const key = commandKey(input.requestId, `transport:${input.settlementId}`);
  let row = await first(store, "auction_transport_bookings", `filter[request_key][$eq]=${encodeURIComponent(key)}&limit=1`);
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_transport_bookings", {
      request_key: key,
      settlement_id: input.settlementId,
      requested_by: actor.id,
      requested_by_username: actor.username,
      transporter: input.transporter.trim().slice(0, 120),
      transporter_reference: input.transporterReference ?? null,
      pickup_location: input.pickupLocation.trim().slice(0, 200),
      destination: input.destination.trim().slice(0, 200),
      scheduled_at: input.scheduledAt ?? null,
      status: input.scheduledAt ? "SCHEDULED" : "REQUESTED",
      created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      updated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    });
    row = id == null ? null : await store.get("auction_transport_bookings", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Transport request could not be persisted.", replayed };
  return { ok: true, replayed, transport: row, bundle: await settlementBundle(store, actor, input.settlementId) };
}

export async function submitHandoverCommand(
  store: AuctionCoreStore,
  actor: CommercialIdentity,
  input: { commandId?: string | null; settlementId: number; evidenceReference: string },
) {
  const settlement = await store.get("auction_settlements", input.settlementId);
  const eventId = settlement?.event_id == null ? null : Number(settlement.event_id);
  const authorized =
    actor.admin ||
    await hasOperationCapability(store, actor, "RELEASE_OPERATOR", eventId) ||
    await hasOperationCapability(store, actor, "TRANSPORT_OPERATOR", eventId);
  const key = commandKey(input.commandId, `handover:${input.settlementId}`);
  let row = await first(store, "auction_handover_commands", `filter[command_key][$eq]=${encodeURIComponent(key)}&limit=1`);
  const replayed = !!row;
  if (!row) {
    const id = await store.create("auction_handover_commands", {
      command_key: key,
      settlement_id: input.settlementId,
      actor_user: actor.id,
      actor_username: actor.username,
      actor_admin: authorized ? 1 : 0,
      evidence_reference: input.evidenceReference.trim().slice(0, 160),
    });
    row = id == null ? null : await store.get("auction_handover_commands", id);
  }
  if (!row) return { ok: false, code: "COMMAND_PERSIST_FAILED", error: "Handover command could not be persisted.", replayed };
  if (row.status !== "accepted") {
    const code = String(row.error_code ?? "HANDOVER_COMMAND_REJECTED");
    return {
      ok: false,
      code,
      error: code === "HANDOVER_AUTHORITY_REQUIRED"
        ? "Release/Yard authority is required to record physical handover."
        : code === "RELEASE_NOT_AUTHORIZED"
          ? "Physical handover requires a valid unused release authorization."
          : "Handover command was rejected.",
      replayed,
      command: row,
    };
  }
  return { ok: true, replayed, command: row, bundle: await settlementBundle(store, actor, input.settlementId) };
}
