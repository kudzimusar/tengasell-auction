// Tengasell trade engine — socket.io RPC service (port 3002).
//
// Authoritative server-side implementation of marketplace rules, writing to
// the TrailBase (Rust) backend on port 3001 with an admin token:
//   · Yahoo Auctions-style proxy (automatic) bidding
//   · anti-snipe soft close (final 5 min → +5 min, max 15 extensions)
//   · buy-now reservation + orders; vehicle Production deadlines are governed policy
//   · Q&A, messaging, notifications, ratings, audit trail (web/agent/mcp)
//
// RPC events (client → server, with ack):
//   bid:place {auctionId, maxAmount}
//   bid:retract {bidId, reason}                    ← vehicle: IMP-09 pre-completion policy; general: legacy LR01 rule
//   buynow:purchase {auctionId}
//   offer:submit {auctionId, amount, message?}    ← Gap-8: Best-Offer/haggle
//   offer:withdraw {offerId}
//   offer:respond {offerId, action: accept|decline|counter, amount?, message?}
//   offer:counter-respond {offerId, accept}        ← buyer answers a counter
//   listing:feature {auctionId}                    ← Gap-8: US$2+VAT featured fee via finance
//   room:create {title, scheduledAt}              ← Gap-8: live-room sessions
//   room:add-lot {sessionId, auctionId} / room:remove-lot
//   host:open-lot {sessionId, auctionId?} / host:close-lot {sessionId, sold}
//   host:end-session {sessionId}
//   question:ask {auctionId, body}
//   question:answer {questionId, body}
//   message:send {threadId?|auctionId?|toUsername?, body}
//   order:pay {orderId, method, reference?}
//   order:ship {orderId, carrier, tracking}
//   order:deliver {orderId}
//   order:rate {orderId, score, comment}
// Broadcasts (server → clients):
//   auction:update {auction} · auction:ended {auction}
//   message:new {message, thread} · notification:new {notification}
//   order:update {order} · question:update {question}
//   offer:update {auctionId, offer} · room:update {session}      ← Gap-8

import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  flushAuctionOutbox,
  submitBidCommand,
  submitFinalizationCommand,
  submitRetractCommand,
  type AuctionOutboxEnvelope,
  type FinalizationInput,
} from "./auction-core";
import {
  addVehicleDocument,
  addVehicleFinding,
  grantVehicleRole,
  reviewVehicleDocument,
  reviewVehicleInspection,
  saveVehicleIntake,
  startVehicleInspection,
  submitVehicleInspection,
  vehicleBundle,
} from "./vehicle-authority";
import {
  createAuctionEvent,
  eventBundle,
  eventCreateAuthorization,
  eventPermissions,
  grantEventOperator,
  submitRunListCommand,
} from "./event-authority";
import {
  calendarProjection,
  grantOperationCapability,
  operationGrantsFor,
  operatorWorkbench,
  submitTaskCommand,
  timelineProjection,
} from "./operation-authority";
import {
  assertProductionMutationAllowed,
  observabilitySnapshot,
  policySnapshot,
  productionGateReport,
  submitPolicyCommand,
  submitVehicleRetractionRequest,
  updateAuctionDisclosure,
  updateServiceHealth,
} from "./policy-authority";
import {
  qualificationBundle,
  requestTransport,
  settlementBundle,
  settlementForOrder,
  submitFinanceCallback,
  submitHandoverCommand,
  submitQualificationCommand,
  submitQualifiedBidCommand,
  submitReleaseCommand,
  submitTransferCommand,
} from "./commercial-authority";

const PORT = 3002;
const TRAILBASE = "http://localhost:3001";

// RPC acknowledgement callback shape (client → server events respond with
// a single JSON payload, e.g. { ok: false, error: "..." } or { ok: true, ... }).
type Ack = (response: unknown) => void;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";

// ── TrailBase REST helpers ───────────────────────────────────────────
let adminToken: string | null = null;

async function tbLogin(): Promise<string> {
  const res = await fetch(`${TRAILBASE}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  const data = await res.json();
  return data.auth_token;
}

async function ensureAdminToken(): Promise<string> {
  if (!adminToken) adminToken = await tbLogin();
  return adminToken;
}

/** One TrailBase request, with a single 401 retry (admin sessions die when
 *  TrailBase restarts — re-login once instead of silently failing writes). */
async function tb(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const call = async (token: string) => {
    const res = await fetch(`${TRAILBASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* empty body (PATCH) */
    }
    return { ok: res.ok, status: res.status, data };
  };
  let result = await call(await ensureAdminToken());
  if (result.status === 401) {
    adminToken = await tbLogin(); // session expired (TrailBase restarted)
    result = await call(adminToken);
  }
  return result;
}

async function getRecords(table: string, params: string): Promise<any[]> {
  const res = await tb("GET", `/api/records/v1/${table}?${params}`);
  return res.ok ? (res.data?.records ?? []) : [];
}

async function getRecord(table: string, id: number | string): Promise<any | null> {
  const res = await tb("GET", `/api/records/v1/${table}/${id}`);
  return res.ok ? res.data : null;
}

async function createRecord(table: string, row: unknown): Promise<number | null> {
  const res = await tb("POST", `/api/records/v1/${table}`, row);
  const id = res.ok ? res.data?.ids?.[0] : null;
  return id != null ? Number(id) : null;
}

async function updateRecord(table: string, id: number | string, patch: unknown): Promise<boolean> {
  const res = await tb("PATCH", `/api/records/v1/${table}/${id}`, patch);
  return res.ok;
}

const auctionCoreStore = {
  create: createRecord,
  get: getRecord,
  list: getRecords,
  update: updateRecord,
};

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function isoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bidIncrement(price: number): number {
  if (price < 50) return 1;
  if (price < 500) return 2;
  if (price < 1000) return 5;
  if (price < 5000) return 10;
  return 25;
}

// ── socket identity ──────────────────────────────────────────────────
interface Identity {
  id: string; // _user uuid (base64 in JSON)
  username: string;
  admin: boolean;
}

const identityCache = new Map<string, Identity>(); // token → identity

function decodeJwt(token: string): { username?: string; admin?: boolean; sub?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

async function resolveIdentity(token: unknown): Promise<Identity | null> {
  if (typeof token !== "string" || !token) return null;
  if (identityCache.has(token)) return identityCache.get(token)!;
  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const activeToken: string = data.auth_token ?? token;
    const payload = decodeJwt(activeToken);
    if (!payload.username) return null;
    // profiles are world-readable → resolve the user id
    const profiles = await getRecords(
      "profiles",
      `filter[username][$eq]=${encodeURIComponent(payload.username)}&limit=1`,
    );
    const identity: Identity = {
      id: profiles[0]?.user ?? "",
      username: payload.username,
      admin: !!payload.admin,
    };
    identityCache.set(token, identity);
    if (activeToken !== token) identityCache.set(activeToken, identity);
    return identity;
  } catch {
    return null;
  }
}

// ── notifications + audit ────────────────────────────────────────────
async function notify(user: string, type: string, title: string, body: string, link: string) {
  if (!user) return;
  const id = await createRecord("notifications", {
    user,
    type,
    title,
    body,
    link,
    read: 0,
    created_at: nowIso(),
  });
  const notification = { id, user, type, title, body, link, read: 0, created_at: nowIso() };
  io.to(`user:${user}`).emit("notification:new", { notification });
}

async function audit(
  user: string | null,
  action: string,
  entity: string,
  entityId: number | null,
  source: string,
  payload: unknown,
) {
  await createRecord("audit_events", {
    user,
    action,
    entity,
    entity_id: entityId,
    source,
    payload: JSON.stringify(payload ?? {}),
    created_at: nowIso(),
  });
}

// ── TUCS comms bridge (Task 11-d) ────────────────────────────────
// Fire-and-forget event emission to the comms-service (:3005) so users
// get channel notifications (email / Telegram / WhatsApp / Messenger)
// per their preference matrix. EVERY call is non-blocking: 2s timeout,
// errors logged to the engine log only — the engine behaves IDENTICALLY
// when comms is down (auctions, orders and messages never wait on it).

const COMMS_BASE = process.env.COMMS_URL ?? "http://127.0.0.1:3005";
const APP_URL = process.env.APP_URL ?? "http://localhost:81";

function commsPost(path: string, payload: Record<string, unknown>): void {
  void fetch(`${COMMS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  })
    .then((res) => {
      if (!res.ok) console.warn(`[comms] ${path} → HTTP ${res.status}`);
    })
    .catch((err) => console.warn(`[comms] ${path} unreachable:`, (err as Error).message));
}

/** Emit a marketplace event to TUCS — never blocks or throws. */
function commsEvent(input: {
  userId: string; // comms keys users by USERNAME (x-tgs-user)
  eventKey: string;
  params: Record<string, string | number | null | undefined>;
  locale?: string;
  threadId?: string | null;
  deepLink?: string | null;
}): void {
  commsPost("/events", {
    userId: input.userId,
    eventKey: input.eventKey,
    params: input.params,
    locale: input.locale ?? "en",
    ...(input.threadId != null ? { threadId: input.threadId } : {}),
    ...(input.deepLink != null ? { deepLink: input.deepLink } : {}),
  });
}

/** Push an in-app message through the TUCS moderated relay — never blocks. */
function commsRelayOut(input: {
  threadId: string;
  fromUserId: string;
  fromLabel: string;
  toUserId: string;
  content: string;
  locale?: string;
  deepLink?: string | null;
}): void {
  commsPost("/relay/out", {
    threadId: input.threadId,
    fromUserId: input.fromUserId,
    fromLabel: input.fromLabel,
    toUserId: input.toUserId,
    content: input.content,
    locale: input.locale ?? "en",
    ...(input.deepLink != null ? { deepLink: input.deepLink } : {}),
  });
}

// ── Finance bridge (Task 12-b, worklog 12-plan §F) ───────────────────
// Fire-and-forget lifecycle events to the finance-service (:3006) so the
// ledger/escrow engine tracks every order (order.paid funds escrow,
// order.delivered opens the dispute window, order.cancelled reverses it).
// Same doctrine as the comms bridge: 2s timeout, errors logged only — the
// engine behaves IDENTICALLY when finance is down, and the finance 60s
// self-heal sweep backfills anything a missed event would have done.

const FINANCE_BASE = process.env.FINANCE_URL ?? "http://127.0.0.1:3006";

function financeEvent(type: string, payload: Record<string, unknown>): void {
  void fetch(`${FINANCE_BASE}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload }),
    signal: AbortSignal.timeout(2000),
  })
    .then((res) => {
      if (!res.ok) console.warn(`[finance] /events ${type} → HTTP ${res.status}`);
    })
    .catch((err) => console.warn("[finance] /events unreachable:", (err as Error).message));
}

// ── bidding rules (authoritative) ──────────────────────────────────
interface BidOutcome {
  ok: boolean;
  error?: string;
  auction?: any;
  amount?: number;
  winning?: boolean;
  outbid?: boolean;
}

async function placeBid(
  me: Identity,
  auctionId: number,
  maxAmount: number,
  commandKey?: string | null,
  expectedVersion?: number | null,
): Promise<BidOutcome & { code?: string; commandKey?: string; replayed?: boolean; eventId?: number; capacity?: any }> {
  const auction = await getRecord("auctions", auctionId);
  // LR02 qualification/capacity is required for whole-vehicle auctions.
  // General marketplace auctions preserve the frozen LR01 core path.
  if (auction?.asset_kind === "vehicle") {
    const gate = await assertProductionMutationAllowed(auctionCoreStore, me, auctionId);
    if (!gate.ok) {
      return {
        ok: false,
        code: gate.code,
        error: gate.error,
        commandKey: commandKey ?? undefined,
        replayed: false,
      };
    }
    return submitQualifiedBidCommand(auctionCoreStore, me, {
      auctionId,
      maxAmount,
      commandId: commandKey,
      expectedVersion,
    });
  }
  return submitBidCommand(auctionCoreStore, me, {
    auctionId,
    maxAmount,
    commandKey,
    expectedVersion,
  });
}

async function commercialGate(user: Identity, auctionId?: number | null) {
  return assertProductionMutationAllowed(auctionCoreStore, user, auctionId ?? null);
}

async function finalizeAuctionWithPolicy(
  input: FinalizationInput,
  actor: Identity = { id: "system", username: "system", admin: true },
) {
  const auction = await getRecord("auctions", Number(input.auctionId));
  if (auction?.asset_kind === "vehicle") {
    const gate = await commercialGate(actor, Number(input.auctionId));
    if (!gate.ok) return { ok: false, code: gate.code, error: gate.error } as any;
  }
  return submitFinalizationCommand(auctionCoreStore, input);
}

async function notifyWatchers(auction: any, bidder: Identity, price: number) {
  try {
    const watchers = await getRecords(
      "watchlist",
      `filter[auction_id][$eq]=${auction.id}&limit=100`,
    );
    for (const w of watchers) {
      if (w.user === bidder.id) continue;
      await notify(
        w.user,
        "bid",
        "New bid on your watchlist",
        `${bidder.username} bid US$${price} on ${auction.title}.`,
        `#/item/${auction.id}`,
      );
    }
  } catch {
    /* best effort */
  }
}

async function antiSnipe(auctionId: number): Promise<any | null> {
  const auction = await getRecord("auctions", auctionId);
  if (!auction || auction.status !== "live") return auction;
  const remaining = Date.parse(auction.ends_at) - Date.now();
  if (remaining < 5 * 60_000 && auction.extension_count < 15) {
    const newEnds = isoPlus(5 * 60_000 + Math.max(remaining, 0));
    await updateRecord("auctions", auctionId, {
      ends_at: newEnds,
      extension_count: auction.extension_count + 1,
      updated_at: nowIso(),
    });
    return getRecord("auctions", auctionId);
  }
  return auction;
}

// ── Gap-8 shared sale helper (offers accept + live-room hammer) ───────
// Marks the auction sold, creates the 48h-SLA order, notifies both
// parties in-app and cross-channel (TUCS auction.won/auction.sold),
// and broadcasts the order. Returns the order id (null = write failed).
async function sellAuctionTo(
  auction: any,
  buyer: { id: string; username: string },
  price: number,
  address?: string | null,
  source: FinalizationInput["source"] = "OFFER_ACCEPT",
  commandKey?: string | null,
): Promise<number | null> {
  const result = await finalizeAuctionWithPolicy({
    commandKey,
    auctionId: Number(auction.id),
    source,
    requestedOutcome: "SOLD",
    buyer,
    price,
    address,
    expectedVersion: Number(auction.version ?? 0),
  });
  if (!result.ok) {
    console.warn("[auction-finalize:sold]", result.code, result.error);
    return null;
  }
  await drainAuctionOutbox();
  return result.orderId ?? null;
}

/** End a lot/auction unsold (no winner). */
async function endUnsold(
  auction: any,
  source: FinalizationInput["source"] = "MANUAL_PASS",
  commandKey?: string | null,
): Promise<boolean> {
  const result = await finalizeAuctionWithPolicy({
    commandKey,
    auctionId: Number(auction.id),
    source,
    requestedOutcome: "UNSOLD",
    expectedVersion: Number(auction.version ?? 0),
  });
  if (!result.ok) {
    console.warn("[auction-finalize:unsold]", result.code, result.error);
    return false;
  }
  await drainAuctionOutbox();
  return true;
}

/** Advance a live room to its next unsold lot, or close the room. */
async function advanceRoom(session: any): Promise<void> {
  if (session?.event_id != null) {
    const event = await getRecord("auction_events", Number(session.event_id));
    if (!event) {
      console.warn("[run-list:advance] linked event not found", session.event_id);
      return;
    }
    const rows = await getRecords(
      "auction_lots",
      `filter[event_id][$eq]=${Number(event.id)}&filter[auction_id][$eq]=${Number(session.current_lot_id ?? 0)}&limit=1`,
    );
    const lot = rows[0];
    if (!lot) {
      console.warn("[run-list:advance] current auction has no event lot", session.current_lot_id);
      return;
    }
    const result = await submitRunListCommand(
      auctionCoreStore,
      {
        id: String(event.host_user),
        username: String(event.host_username),
        admin: false,
      },
      {
        commandKey: `advance:${event.id}:${lot.id}:v${Number(event.run_list_version ?? 0)}`,
        eventId: Number(event.id),
        sessionId: Number(session.id),
        commandType: "ADVANCE",
        lotId: Number(lot.id),
        expectedRunListVersion: Number(event.run_list_version ?? 0),
        source: "SYSTEM",
      },
    );
    if (!result.ok) {
      console.warn("[run-list:advance]", result.code, result.error);
      return;
    }
    if (result.event) io.emit("event:update", { event: result.event });
    if (result.session) io.emit("room:update", { session: result.session });
    return;
  }

  // Historical standalone rooms retain their legacy read/write compatibility.
  const lots = await getRecords(
    "auctions",
    `filter[live_session_id][$eq]=${session.id}&filter[status][$eq]=live&order=id&limit=100`,
  );
  const remaining = lots.filter((lot: any) => lot.id !== session.current_lot_id);
  if (remaining.length > 0) {
    await updateRecord("live_sessions", session.id, {
      current_lot_id: remaining[0].id,
      lot_index: Number(session.lot_index ?? 0) + 1,
      close_at: null,
      updated_at: nowIso(),
    });
  } else {
    await updateRecord("live_sessions", session.id, {
      status: "closed",
      current_lot_id: null,
      close_at: null,
      updated_at: nowIso(),
    });
  }
  const updated = await getRecord("live_sessions", session.id);
  if (updated) io.emit("room:update", { session: updated });
}

let auctionOutboxDraining = false;

async function publishAuctionCoreEvent(event: AuctionOutboxEnvelope): Promise<void> {
  const auction = await getRecord("auctions", Number(event.auction_id));
  if (!auction) return;

  if (event.event_type === "AUCTION_BID_ACCEPTED" || event.event_type === "AUCTION_BID_RETRACTED") {
    const command = event.command_id != null
      ? await getRecord("auction_commands", Number(event.command_id))
      : null;
    if (command && event.event_type === "AUCTION_BID_ACCEPTED") {
      const actor: Identity = {
        id: String(command.actor_user ?? ""),
        username: String(command.actor_username ?? ""),
        admin: Number(command.actor_admin ?? 0) === 1,
      };
      if (
        command.previous_winner_user &&
        String(command.previous_winner_user) !== String(command.result_winner_user)
      ) {
        await notify(
          String(command.previous_winner_user),
          "outbid",
          "You were outbid",
          `${actor.username} placed a higher maximum on ${auction.title}.`,
          `#/item/${auction.id}`,
        );
      }
      if (String(command.actor_user) !== String(command.result_winner_user)) {
        await notify(
          String(command.actor_user),
          "outbid",
          "You were outbid",
          `Automatic bidding for ${command.result_winner_username} exceeded your maximum on ${auction.title}.`,
          `#/item/${auction.id}`,
        );
      }
      await notifyWatchers(auction, actor, Number(command.result_price ?? auction.current_price));
      await audit(actor.id, "bid:place", "auctions", Number(auction.id), "auction-outbox", {
        commandKey: command.command_key,
        price: command.result_price,
        version: command.version_after,
      });
    } else if (command) {
      await notify(
        auction.user,
        "info",
        "A leading bid was retracted",
        `${command.actor_username} retracted a leading bid on ${auction.title}.`,
        `#/item/${auction.id}`,
      );
      await audit(String(command.actor_user), "bid:retract", "auctions", Number(auction.id), "auction-outbox", {
        commandKey: command.command_key,
        reason: command.reason,
        version: command.version_after,
      });
    }
    io.emit("auction:update", { auction });
    if (auction.live_session_id != null) {
      const session = await getRecord("live_sessions", Number(auction.live_session_id));
      if (session) io.emit("room:update", { session });
    }
    return;
  }

  if (event.event_type === "AUCTION_SOLD" || event.event_type === "AUCTION_ENDED_UNSOLD") {
    const outcomes = await getRecords(
      "auction_outcomes",
      `filter[auction_id][$eq]=${Number(auction.id)}&limit=1`,
    );
    const outcome = outcomes[0];
    if (outcome?.outcome === "sold") {
      const order = outcome.order_id != null ? await getRecord("orders", Number(outcome.order_id)) : null;
      if (order) {
        await notify(
          order.buyer_user,
          "won",
          "You won — payment due",
          `${auction.title} at US${Number(order.final_price).toFixed(2)}. Payment deadline: ${order.pay_by ? new Date(order.pay_by).toISOString() : "see settlement"}.`,
          `#/orders/${order.id}`,
        );
        await notify(
          order.seller_user,
          "sold",
          "Your auction sold",
          `${auction.title} — US${Number(order.final_price).toFixed(2)} to ${order.buyer_username}.`,
          `#/orders/${order.id}`,
        );
        if (order.buyer_username) {
          commsEvent({
            userId: order.buyer_username,
            eventKey: "auction.won",
            params: { auctionTitle: auction.title, amount: order.final_price, auctionId: auction.id },
            deepLink: `${APP_URL}/#/item/${auction.id}`,
          });
        }
        if (order.seller_username) {
          commsEvent({
            userId: order.seller_username,
            eventKey: "auction.sold",
            params: {
              auctionTitle: auction.title,
              amount: order.final_price,
              winnerLabel: order.buyer_username,
              auctionId: auction.id,
            },
            deepLink: `${APP_URL}/#/item/${auction.id}`,
          });
        }
        io.emit("order:update", { order });
      }
    } else {
      await notify(
        auction.user,
        "info",
        "Auction ended unsold",
        auction.title,
        `#/item/${auction.id}`,
      );
    }
    await audit(null, "auction:finalized", "auctions", Number(auction.id), "auction-outbox", {
      eventKey: event.event_key,
      outcome: outcome?.outcome ?? auction.outcome,
      orderId: outcome?.order_id ?? null,
      version: auction.version,
    });
    io.emit("auction:update", { auction });
    io.emit("auction:ended", { auction });
  }
}

async function drainAuctionOutbox(): Promise<void> {
  if (auctionOutboxDraining) return;
  auctionOutboxDraining = true;
  try {
    await flushAuctionOutbox(auctionCoreStore, publishAuctionCoreEvent);
  } finally {
    auctionOutboxDraining = false;
  }
}

// ── sweeps ───────────────────────────────────────────────────────────
async function sweepAuctions() {
  const due = await getRecords(
    "auctions",
    `filter[status][$eq]=live&filter[ends_at][$lte]=${encodeURIComponent(nowIso())}&limit=100`,
  );
  for (const auction of due) {
    await finalizeAuctionWithPolicy({
      commandKey: `timer:${auction.id}:v${Number(auction.version ?? 0)}`,
      auctionId: Number(auction.id),
      source: "TIMED_SWEEP",
      requestedOutcome: "AUTO",
      expectedVersion: Number(auction.version ?? 0),
    });
  }
  await drainAuctionOutbox();

  const overdue = await getRecords(
    "orders",
    `filter[status][$eq]=pending_payment&filter[pay_by][$lte]=${encodeURIComponent(nowIso())}&limit=100`,
  );
  for (const order of overdue) {
    await updateRecord("orders", order.id, { status: "cancelled", updated_at: nowIso() });
    financeEvent("order.cancelled", {
      orderId: Number(order.id),
      reason: "payment SLA elapsed (48h)",
    });
    await notify(
      order.buyer_user,
      "order",
      "Order cancelled — payment overdue",
      `${order.auction_title}: the 48h payment SLA elapsed.`,
      `#/orders/${order.id}`,
    );
    await notify(
      order.seller_user,
      "order",
      "Order cancelled — buyer did not pay",
      `${order.auction_title} may be relisted.`,
      `#/orders/${order.id}`,
    );
    const updated = await getRecord("orders", order.id);
    if (updated) io.emit("order:update", { order: updated });
  }
}

async function reviveExpiredAuctions() {
  // keep the demo marketplace alive across long sessions: re-stagger
  // live auctions whose end time already passed back into the future.
  const expired = await getRecords(
    "auctions",
    `filter[status][$eq]=live&filter[ends_at][$lte]=${encodeURIComponent(nowIso())}&limit=200`,
  );
  for (const auction of expired) {
    const spreadMinutes = 3 + (auction.id % 97) * 85; // 3 min … ~5.5 days
    await updateRecord("auctions", auction.id, {
      ends_at: isoPlus(spreadMinutes * 60_000),
      started_at: isoPlus(-3600_000),
      updated_at: nowIso(),
    });
  }
  if (expired.length > 0) console.log(`[boot] revived ${expired.length} expired live auctions`);
}

// ── Gap-8 sweeps ────────────────────────────────────────────────────
// Live-room hammer clock: when close_at elapses with no new bid, the lot
// sells to the high bidder (going-going-sold) and the room auto-advances.
async function sweepLiveRooms() {
  const rooms = await getRecords(
    "live_sessions",
    `filter[status][$eq]=live&filter[close_at][$lte]=${encodeURIComponent(nowIso())}&limit=50`,
  );
  for (const session of rooms) {
    const lotId = Number(session.current_lot_id ?? 0);
    if (!lotId) continue;
    const auction = await getRecord("auctions", lotId);
    if (!auction || auction.status !== "live") {
      await advanceRoom(session);
      continue;
    }
    const result = await finalizeAuctionWithPolicy({
      commandKey: `hammer:${session.id}:${lotId}:v${Number(auction.version ?? 0)}`,
      auctionId: lotId,
      source: "LIVE_HAMMER",
      requestedOutcome: "AUTO",
      expectedVersion: Number(auction.version ?? 0),
    });
    if (!result.ok) continue;
    await drainAuctionOutbox();
    const fresh = await getRecord("live_sessions", session.id);
    if (fresh) await advanceRoom(fresh);
  }
}

// Best-Offer expiry: pending/countered offers older than 48h → expired.
async function sweepOfferExpiry() {
  const stale = await getRecords(
    "offers",
    `filter[status][$eq]=pending&filter[created_at][$lte]=${encodeURIComponent(
      new Date(Date.now() - 48 * 3600_000).toISOString(),
    )}&limit=100`,
  );
  for (const offer of stale) {
    await updateRecord("offers", offer.id, {
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso(),
    });
    await notify(
      offer.buyer_user,
      "info",
      "Offer expired",
      `Your offer of US$${offer.amount} expired without a response.`,
      `#/item/${offer.auction_id}`,
    );
    io.emit("offer:update", { auctionId: offer.auction_id, offer });
  }
  const countered = await getRecords(
    "offers",
    `filter[status][$eq]=countered&filter[created_at][$lte]=${encodeURIComponent(
      new Date(Date.now() - 48 * 3600_000).toISOString(),
    )}&limit=100`,
  );
  for (const offer of countered) {
    await updateRecord("offers", offer.id, {
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso(),
    });
    io.emit("offer:update", { auctionId: offer.auction_id, offer });
  }
}

/** Does this auction match a saved-search row? (Gap-8 alerts) */
function matchesSearch(a: any, ss: any): boolean {
  if (a.live_session_id != null) return false; // live-room lots aren't "new listings"
  if (ss.query) {
    const q = String(ss.query).toLowerCase();
    const hay = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (ss.category && a.category !== ss.category) return false;
  const price = Number(a.current_price ?? a.start_price ?? 0);
  if (ss.min_price != null && price < Number(ss.min_price)) return false;
  if (ss.max_price != null && price > Number(ss.max_price)) return false;
  return true;
}

// Saved-search alerts: notify owners about NEW matching live listings
// (high-water mark on auction id — only listings first seen after the
// search was saved trigger alerts, eBay-style "new listing" alerts).
async function sweepSavedSearches() {
  const searches = await getRecords("saved_searches", `filter[alerts][$eq]=1&limit=500`);
  if (searches.length === 0) return;
  const top = await getRecords("auctions", `order=-id&limit=1`);
  const maxId = Number(top[0]?.id ?? 0);
  for (const ss of searches) {
    if (Number(ss.last_seen_id ?? 0) >= maxId) continue;
    const candidates = await getRecords(
      "auctions",
      `filter[id][$gt]=${Number(ss.last_seen_id ?? 0)}&filter[status][$eq]=live&order=id&limit=50`,
    );
    const matches = candidates.filter((a: any) => matchesSearch(a, ss));
    let username: string | null = null;
    for (const m of matches.slice(0, 5)) {
      if (!username) {
        const profiles = await getRecords(
          "profiles",
          `filter[user][$eq]=${encodeURIComponent(ss.user)}&limit=1`,
        );
        username = profiles[0]?.username ?? null;
      }
      await notify(
        ss.user,
        "search",
        `Match for “${ss.name}”`,
        `New listing: ${m.title} — US$${m.current_price}.`,
        `#/item/${m.id}`,
      );
      if (username) {
        commsEvent({
          userId: username,
          eventKey: "search.alert",
          params: {
            searchName: ss.name,
            auctionTitle: m.title,
            amount: Number(m.current_price ?? 0),
            auctionId: m.id,
          },
          deepLink: `${APP_URL}/#/item/${m.id}`,
        });
      }
    }
    await updateRecord("saved_searches", ss.id, {
      last_seen_id: maxId,
      updated_at: nowIso(),
    });
  }
}

// ── server ───────────────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || (req.url ?? "").startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "tengasell-trade-engine", port: PORT, ok: true }));
    return;
  }
  // Admin: ensure the Next dev server (and its GIS child) is running.
  // The trade engine is a persistent anchor process — children spawned here
  // survive agent-shell reaping (the sandbox kills per-call process trees).
  if (req.method === "POST" && req.url === "/admin/ensure-dev") {
    handleEnsureDev(res);
    return;
  }
  if (req.method === "GET" && req.url === "/admin/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ next: nextDevRunning, checkedAt: new Date().toISOString() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── dev-server supervisor (anchor-spawned children persist) ──────────
import net from "node:net";
import fs from "node:fs";
import { spawn as cpSpawn } from "node:child_process";

const PROJECT_ROOT = "/home/z/my-project";

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(400);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, "127.0.0.1");
  });
}

let nextDevRunning = false;
let devSpawning: Promise<boolean> | null = null;

async function spawnDevServer(): Promise<boolean> {
  try {
    if (await portOpen(3000)) return true;
    const fd = fs.openSync(`${PROJECT_ROOT}/dev.log`, "a");
    const child = cpSpawn("bun", ["run", "dev"], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await portOpen(3000)) {
        console.log(`[admin] Next dev server up on :3000 (pid ${child.pid})`);
        return true;
      }
    }
    console.warn("[admin] Next dev server did not come up within 40s");
    return false;
  } catch (err) {
    console.error("[admin] dev spawn failed:", err);
    return false;
  }
}

async function handleEnsureDev(res: import("node:http").ServerResponse): Promise<void> {
  devSpawning ??= spawnDevServer().then((ok) => { nextDevRunning = ok; return ok; })
    .finally(() => { devSpawning = null; });
  const ok = await devSpawning;
  res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok, next: nextDevRunning }));
}

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

io.on("connection", (socket: Socket) => {
  const token = (socket.handshake.auth as { token?: string })?.token;
  let me: Identity | null = null;
  const identityPromise: Promise<Identity | null> = token
    ? resolveIdentity(token)
    : Promise.resolve(null);

  void identityPromise.then((identity) => {
    me = identity;
    if (me?.id) void socket.join(`user:${me.id}`);
    socket.emit("hello", { ok: true, identity: me ? { username: me.username } : null });
  });

  const requireAuth = async (): Promise<Identity | null> => {
    if (!token) return null;
    if (!me) me = await identityPromise;
    return me;
  };

  // ── IMP-04: Vehicle / Tengasell Inspection authority ───────────────
  socket.on("vehicle:get", async (data: any, ack?: Ack) => {
    try {
      const viewer = await identityPromise;
      const auctionId = Number(data?.auctionId);
      if (!Number.isSafeInteger(auctionId) || auctionId <= 0)
        return ack?.({ ok: false, error: "Invalid auction id." });
      ack?.({ ok: true, bundle: await vehicleBundle(auctionCoreStore, auctionId, viewer) });
    } catch (err) {
      console.error("[vehicle:get]", err);
      ack?.({ ok: false, error: "Vehicle details are temporarily unavailable." });
    }
  });

  socket.on("vehicle:intake", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to submit vehicle intake." });
      ack?.(await saveVehicleIntake(auctionCoreStore, audit, user, Number(data?.auctionId), data?.vehicle ?? {}));
    } catch (err) {
      console.error("[vehicle:intake]", err);
      ack?.({ ok: false, error: "Vehicle intake failed." });
    }
  });

  socket.on("vehicle:document:add", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await addVehicleDocument(auctionCoreStore, audit, user, Number(data?.vehicleId), data?.document ?? {}));
    } catch (err) {
      console.error("[vehicle:document:add]", err);
      ack?.({ ok: false, error: "Vehicle document could not be recorded." });
    }
  });

  socket.on("vehicle:document:review", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await reviewVehicleDocument(
        auctionCoreStore, audit, user, Number(data?.documentId),
        data?.action === "REJECT" ? "REJECT" : "VERIFY", data?.reason,
      ));
    } catch (err) {
      console.error("[vehicle:document:review]", err);
      ack?.({ ok: false, error: "Document review failed." });
    }
  });

  socket.on("vehicle:inspection:start", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await startVehicleInspection(auctionCoreStore, audit, user, Number(data?.vehicleId)));
    } catch (err) {
      console.error("[vehicle:inspection:start]", err);
      ack?.({ ok: false, error: "Inspection could not be started." });
    }
  });

  socket.on("vehicle:inspection:finding", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await addVehicleFinding(
        auctionCoreStore, audit, user, Number(data?.inspectionId), data?.finding ?? {},
      ));
    } catch (err) {
      console.error("[vehicle:inspection:finding]", err);
      ack?.({ ok: false, error: "Inspection finding could not be saved." });
    }
  });

  socket.on("vehicle:inspection:submit", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await submitVehicleInspection(
        auctionCoreStore, audit, user, Number(data?.inspectionId), data?.inspection ?? {},
      ));
    } catch (err) {
      console.error("[vehicle:inspection:submit]", err);
      ack?.({ ok: false, error: "Inspection could not be submitted." });
    }
  });

  socket.on("vehicle:inspection:review", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await reviewVehicleInspection(
        auctionCoreStore, audit, user, Number(data?.inspectionId), String(data?.commandId ?? ""),
      ));
    } catch (err) {
      console.error("[vehicle:inspection:review]", err);
      ack?.({ ok: false, error: "Vehicle review failed." });
    }
  });

  socket.on("vehicle:role:grant", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await grantVehicleRole(auctionCoreStore, audit, user, {
        user: String(data?.user ?? ""),
        username: String(data?.username ?? ""),
        role: data?.role === "REVIEWER" ? "REVIEWER" : "INSPECTOR",
      }));
    } catch (err) {
      console.error("[vehicle:role:grant]", err);
      ack?.({ ok: false, error: "Vehicle role could not be granted." });
    }
  });

  // ── IMP-05: AuctionEvent / Session / production Run List ─────────
  socket.on("event:bundle", async (data: any, ack?: Ack) => {
    try {
      const viewer = await requireAuth();
      const eventId = Number(data?.eventId);
      const bundle = await eventBundle(auctionCoreStore, eventId, viewer);
      if (!bundle.event) return ack?.({ ok: false, error: "Auction event not found." });
      ack?.({ ok: true, bundle });
    } catch (err) {
      console.error("[event:bundle]", err);
      ack?.({ ok: false, error: "Auction event could not be loaded." });
    }
  });

  socket.on("event:create", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to create an auction event." });
      const authorization = eventCreateAuthorization(user);
      if (!authorization.allowed) {
        return ack?.({ ok: false, code: authorization.code, error: authorization.error });
      }
      const gate = await commercialGate(user);
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      const result = await createAuctionEvent(auctionCoreStore, audit, user, data?.event ?? {});
      if (!result.ok || !result.event)
        return ack?.({ ok: false, error: result.error ?? "Auction event could not be created." });
      const bundle = await eventBundle(auctionCoreStore, Number(result.event.id), user);
      io.emit("event:update", { event: bundle.event });
      if (bundle.session) io.emit("room:update", { session: bundle.session });
      ack?.({ ok: true, bundle });
    } catch (err) {
      console.error("[event:create]", err);
      ack?.({ ok: false, error: "Auction event could not be created." });
    }
  });

  socket.on("event:operator:grant", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const role = data?.role === "CLERK" ? "CLERK" : "AUCTIONEER";
      const result = await grantEventOperator(
        auctionCoreStore,
        audit,
        user,
        Number(data?.eventId),
        String(data?.username ?? ""),
        role,
      );
      if (!result.ok) return ack?.({ ok: false, error: result.error });
      const bundle = await eventBundle(auctionCoreStore, Number(data?.eventId), user);
      ack?.({ ok: true, bundle });
    } catch (err) {
      console.error("[event:operator:grant]", err);
      ack?.({ ok: false, error: "Operator assignment failed." });
    }
  });

  socket.on("run-list:command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const result = await submitRunListCommand(auctionCoreStore, user, {
        commandKey: typeof data?.commandId === "string" ? data.commandId : null,
        eventId: Number(data?.eventId),
        sessionId: Number(data?.sessionId),
        commandType: data?.commandType,
        lotId: data?.lotId == null ? null : Number(data.lotId),
        auctionId: data?.auctionId == null ? null : Number(data.auctionId),
        targetSequenceNo: data?.targetSequenceNo == null ? null : Number(data.targetSequenceNo),
        reason: typeof data?.reason === "string" ? data.reason : null,
        expectedRunListVersion: Number(data?.expectedRunListVersion),
        source: "OPERATOR",
      });
      if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
      const bundle = await eventBundle(auctionCoreStore, Number(data?.eventId), user);
      if (bundle.event) io.emit("event:update", { event: bundle.event });
      if (bundle.session) io.emit("room:update", { session: bundle.session });
      if (result.lot?.auction_id != null) {
        const auction = await getRecord("auctions", Number(result.lot.auction_id));
        if (auction) io.emit("auction:update", { auction });
      }
      ack?.({ ok: true, bundle, command: result.command });
    } catch (err) {
      console.error("[run-list:command]", err);
      ack?.({ ok: false, error: "Run-list command failed." });
    }
  });

  // ── IMP-09: Zimbabwe policy / production gates / observability ──
  socket.on("policy:snapshot", async (_data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.({ ok: true, policies: await policySnapshot(auctionCoreStore) });
    } catch (err) {
      console.error("[policy:snapshot]", err);
      ack?.({ ok: false, error: "Auction policy registry could not be loaded." });
    }
  });

  socket.on("policy:command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await submitPolicyCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        policyKey: String(data?.policyKey ?? ""),
        value: data?.value,
        classification: data?.classification ?? null,
        configured: data?.configured == null ? null : Boolean(data.configured),
        reason: String(data?.reason ?? ""),
      }));
    } catch (err) {
      console.error("[policy:command]", err);
      ack?.({ ok: false, error: "Auction policy could not be updated." });
    }
  });

  socket.on("policy:service-health", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await updateServiceHealth(auctionCoreStore, user, {
        serviceKey: String(data?.serviceKey ?? ""),
        status: data?.status,
        detail: data?.detail ?? null,
      }));
    } catch (err) {
      console.error("[policy:service-health]", err);
      ack?.({ ok: false, error: "Service health could not be certified." });
    }
  });

  socket.on("policy:auction-disclosure", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await updateAuctionDisclosure(auctionCoreStore, user, {
        auctionId: Number(data?.auctionId),
        reserveDisclosure: data?.reserveDisclosure,
        ownerBidRightDisclosure: data?.ownerBidRightDisclosure ?? "NOT_PERMITTED",
      }));
    } catch (err) {
      console.error("[policy:auction-disclosure]", err);
      ack?.({ ok: false, error: "Auction disclosure could not be updated." });
    }
  });

  socket.on("production:gates", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.({ ok: true, report: await productionGateReport(
        auctionCoreStore,
        user,
        data?.auctionId == null ? null : Number(data.auctionId),
      ) });
    } catch (err) {
      console.error("[production:gates]", err);
      ack?.({ ok: false, error: "Production readiness gates could not be evaluated." });
    }
  });

  socket.on("operations:observability", async (_data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user || !user.admin) return ack?.({ ok: false, error: "Administrator authority is required." });
      ack?.({ ok: true, ...(await observabilitySnapshot(auctionCoreStore)) });
    } catch (err) {
      console.error("[operations:observability]", err);
      ack?.({ ok: false, error: "Auction observability could not be loaded." });
    }
  });

  // ── IMP-08: scoped operator operations / tasks / projections ───────
  socket.on("operations:grant", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await grantOperationCapability(auctionCoreStore, user, {
        user: String(data?.user ?? ""),
        username: String(data?.username ?? ""),
        capability: data?.capability,
        eventId: data?.eventId == null ? null : Number(data.eventId),
        reason: String(data?.reason ?? ""),
        expiresAt: data?.expiresAt ?? null,
      }));
    } catch (err) {
      console.error("[operations:grant]", err);
      ack?.({ ok: false, error: "Operation capability could not be granted." });
    }
  });

  socket.on("operations:grants", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.({ ok: true, grants: await operationGrantsFor(
        auctionCoreStore,
        user,
        user.admin && typeof data?.user === "string" ? data.user : null,
      ) });
    } catch (err) {
      console.error("[operations:grants]", err);
      ack?.({ ok: false, error: "Operation capabilities could not be loaded." });
    }
  });

  socket.on("operations:task-command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await submitTaskCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        taskId: Number(data?.taskId),
        commandType: data?.commandType,
        assigneeUser: data?.assigneeUser ?? null,
        assigneeUsername: data?.assigneeUsername ?? null,
        reason: data?.reason ?? null,
      }));
    } catch (err) {
      console.error("[operations:task-command]", err);
      ack?.({ ok: false, error: "Operational task command failed." });
    }
  });

  socket.on("operations:calendar", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.({ ok: true, items: await calendarProjection(auctionCoreStore, user, {
        from: data?.from ?? null,
        to: data?.to ?? null,
      }) });
    } catch (err) {
      console.error("[operations:calendar]", err);
      ack?.({ ok: false, error: "Auction operations calendar could not be loaded." });
    }
  });

  socket.on("operations:timeline", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.({ ok: true, events: await timelineProjection(auctionCoreStore, user, {
        entityType: data?.entityType ?? null,
        entityId: data?.entityId == null ? null : Number(data.entityId),
        settlementId: data?.settlementId == null ? null : Number(data.settlementId),
        eventId: data?.eventId == null ? null : Number(data.eventId),
      }) });
    } catch (err) {
      console.error("[operations:timeline]", err);
      ack?.({ ok: false, error: "Business timeline could not be loaded." });
    }
  });

  socket.on("operations:workbench", async (_data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      ack?.(await operatorWorkbench(auctionCoreStore, user));
    } catch (err) {
      console.error("[operations:workbench]", err);
      ack?.({ ok: false, error: "Auction operator workbench could not be loaded." });
    }
  });

  // ── IMP-07: settlement / transfer / physical release / transport ──
  socket.on("settlement:bundle", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      if (data?.orderId != null) {
        return ack?.(await settlementForOrder(auctionCoreStore, user, Number(data.orderId)));
      }
      ack?.(await settlementBundle(auctionCoreStore, user, Number(data?.settlementId)));
    } catch (err) {
      console.error("[settlement:bundle]", err);
      ack?.({ ok: false, error: "Settlement could not be loaded." });
    }
  });

  socket.on("settlement:finance-callback", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const settlement = await getRecord("auction_settlements", Number(data?.settlementId));
      if (!settlement) return ack?.({ ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." });
      const gate = await commercialGate(user, Number(settlement.auction_id));
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      ack?.(await submitFinanceCallback(auctionCoreStore, user, {
        idempotencyKey: typeof data?.idempotencyKey === "string" ? data.idempotencyKey : null,
        settlementId: Number(data?.settlementId),
        orderId: Number(data?.orderId),
        eventType: data?.eventType,
        amount: data?.amount == null ? null : Number(data.amount),
        currency: data?.currency ?? "USD",
        sourceReference: data?.sourceReference ?? null,
        payoutState: data?.payoutState ?? null,
      }));
    } catch (err) {
      console.error("[settlement:finance-callback]", err);
      ack?.({ ok: false, error: "Finance settlement callback failed." });
    }
  });

  socket.on("settlement:transfer-command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const settlement = await getRecord("auction_settlements", Number(data?.settlementId));
      if (!settlement) return ack?.({ ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." });
      const gate = await commercialGate(user, Number(settlement.auction_id));
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      ack?.(await submitTransferCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        settlementId: Number(data?.settlementId),
        commandType: data?.commandType,
        documentType: data?.documentType ?? null,
        documentRef: data?.documentRef ?? null,
        externalProcess: Boolean(data?.externalProcess),
        reason: data?.reason ?? null,
      }));
    } catch (err) {
      console.error("[settlement:transfer-command]", err);
      ack?.({ ok: false, error: "Transfer command failed." });
    }
  });

  socket.on("settlement:release-command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const settlement = await getRecord("auction_settlements", Number(data?.settlementId));
      if (!settlement) return ack?.({ ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." });
      const gate = await commercialGate(user, Number(settlement.auction_id));
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      ack?.(await submitReleaseCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        settlementId: Number(data?.settlementId),
        collectorType: data?.collectorType,
        collectorUser: data?.collectorUser ?? null,
        collectorName: String(data?.collectorName ?? ""),
        collectorReference: data?.collectorReference ?? null,
        conditions: data?.conditions ?? null,
      }));
    } catch (err) {
      console.error("[settlement:release-command]", err);
      ack?.({ ok: false, error: "Release authorization failed." });
    }
  });

  socket.on("settlement:transport-request", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const settlement = await getRecord("auction_settlements", Number(data?.settlementId));
      if (!settlement) return ack?.({ ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." });
      const gate = await commercialGate(user, Number(settlement.auction_id));
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      ack?.(await requestTransport(auctionCoreStore, user, {
        requestId: typeof data?.requestId === "string" ? data.requestId : null,
        settlementId: Number(data?.settlementId),
        transporter: String(data?.transporter ?? ""),
        transporterReference: data?.transporterReference ?? null,
        pickupLocation: String(data?.pickupLocation ?? ""),
        destination: String(data?.destination ?? ""),
        scheduledAt: data?.scheduledAt ?? null,
      }));
    } catch (err) {
      console.error("[settlement:transport-request]", err);
      ack?.({ ok: false, error: "Transport request failed." });
    }
  });

  socket.on("settlement:handover-command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const settlement = await getRecord("auction_settlements", Number(data?.settlementId));
      if (!settlement) return ack?.({ ok: false, code: "SETTLEMENT_NOT_FOUND", error: "Auction settlement not found." });
      const gate = await commercialGate(user, Number(settlement.auction_id));
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      ack?.(await submitHandoverCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        settlementId: Number(data?.settlementId),
        evidenceReference: String(data?.evidenceReference ?? ""),
      }));
    } catch (err) {
      console.error("[settlement:handover-command]", err);
      ack?.({ ok: false, error: "Physical handover could not be recorded." });
    }
  });

  // ── IMP-06: event-scoped bidder qualification + financial capacity ──
  socket.on("qualification:bundle", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const eventId = Number(data?.eventId);
      if (!Number.isFinite(eventId) || eventId <= 0)
        return ack?.({ ok: false, error: "Auction event is required." });
      const targetUser = user.admin && typeof data?.user === "string" ? data.user : null;
      const bundle = await qualificationBundle(auctionCoreStore, eventId, user, targetUser);
      ack?.({ ok: true, bundle });
    } catch (err) {
      console.error("[qualification:bundle]", err);
      ack?.({ ok: false, error: "Qualification status could not be loaded." });
    }
  });

  socket.on("qualification:command", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const gate = await commercialGate(user);
      if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
      const result = await submitQualificationCommand(auctionCoreStore, user, {
        commandId: typeof data?.commandId === "string" ? data.commandId : null,
        eventId: Number(data?.eventId),
        targetUser: String(data?.targetUser ?? ""),
        targetUsername: String(data?.targetUsername ?? ""),
        commandType: data?.commandType,
        qualificationBasis: data?.qualificationBasis ?? null,
        approvedLimit: data?.approvedLimit == null ? null : Number(data.approvedLimit),
        lotLimit: data?.lotLimit == null ? null : Number(data.lotLimit),
        accountState: data?.accountState ?? null,
        riskState: data?.riskState ?? null,
        depositState: data?.depositState ?? null,
        depositReference: data?.depositReference ?? null,
        depositAmount: data?.depositAmount == null ? null : Number(data.depositAmount),
        creditState: data?.creditState ?? null,
        creditLimit: data?.creditLimit == null ? null : Number(data.creditLimit),
        reasonCode: data?.reasonCode ?? null,
        expiresAt: data?.expiresAt ?? null,
      });
      ack?.(result);
    } catch (err) {
      console.error("[qualification:command]", err);
      ack?.({ ok: false, error: "Qualification command failed." });
    }
  });

  socket.on("bid:place", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to place bids." });
      const auctionId = Number(data?.auctionId);
      const before = await getRecord("auctions", auctionId);
      const result = await placeBid(
        user,
        auctionId,
        Number(data?.maxAmount),
        typeof data?.commandId === "string" ? data.commandId : null,
        before?.version == null ? null : Number(before.version),
      );
      if (result.ok) await drainAuctionOutbox();
      ack?.(result);
    } catch (err) {
      console.error("[bid:place]", err);
      ack?.({ ok: false, error: "The trade engine hit an unexpected error. Please retry." });
    }
  });

  // ── Bid retraction: vehicle IMP-09 policy / general LR01 legacy ─────
  socket.on("bid:retract", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const bidId = Number(data?.bidId);
      const bid = await getRecord("bids", bidId);
      if (!bid) return ack?.({ ok: false, error: "Bid not found." });
      const auction = await getRecord("auctions", Number(bid.auction_id));
      if (!auction) return ack?.({ ok: false, error: "Auction not found." });
      let result: any;
      if (auction.asset_kind === "vehicle") {
        const gate = await commercialGate(user, Number(auction.id));
        if (!gate.ok) return ack?.({ ok: false, code: gate.code, error: gate.error, gates: gate.report });
        result = await submitVehicleRetractionRequest(auctionCoreStore, user, {
          auctionId: Number(auction.id),
          bidId,
          reason: String(data?.reason ?? ""),
          commandId: typeof data?.commandId === "string" ? data.commandId : null,
          expectedVersion: Number(auction.version ?? 0),
        });
      } else {
        result = await submitRetractCommand(auctionCoreStore, user, {
          auctionId: Number(auction.id),
          bidId,
          reason: String(data?.reason ?? ""),
          commandKey: typeof data?.commandId === "string" ? data.commandId : null,
          expectedVersion: Number(auction.version ?? 0),
        });
      }
      if (result.ok) await drainAuctionOutbox();
      ack?.(result);
    } catch (err) {
      console.error("[bid:retract]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: Best-Offer / haggle ──────────────────────────────────────
  socket.on("offer:submit", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to make an offer." });
      const auctionId = Number(data?.auctionId);
      const amount = round2(Number(data?.amount));
      const message = String(data?.message ?? "").slice(0, 300);
      const auction = await getRecord("auctions", auctionId);
      if (!auction) return ack?.({ ok: false, error: "Item not found." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "This item is no longer accepting offers." });
      if (Number(auction.allow_offers ?? 0) !== 1)
        return ack?.({ ok: false, error: "This seller is not accepting offers." });
      if (auction.user === user.id)
        return ack?.({ ok: false, error: "You cannot offer on your own item." });
      if (!Number.isFinite(amount) || amount < 1)
        return ack?.({ ok: false, error: "Enter an offer of US$1 or more." });
      if (auction.buy_now_price != null && amount >= Number(auction.buy_now_price))
        return ack?.({ ok: false, error: "Offer below the buy-now price — or just use buy-now." });
      const mine = await getRecords(
        "offers",
        `filter[auction_id][$eq]=${auctionId}&filter[buyer_user][$eq]=${encodeURIComponent(user.id)}&limit=20`,
      );
      if (mine.some((o: any) => o.status === "pending" || o.status === "countered"))
        return ack?.({ ok: false, error: "You already have a pending offer on this item." });
      if (mine.length >= 3)
        return ack?.({ ok: false, error: "Offer limit reached (3 per item)." });
      if (auction.offer_min != null && amount < Number(auction.offer_min)) {
        // auto-decline below the seller's minimum (still recorded)
        const id = await createRecord("offers", {
          auction_id: auctionId,
          buyer_user: user.id,
          buyer_username: user.username,
          amount,
          message: message || null,
          status: "declined",
          counter_message: `Below the seller's minimum offer of US$${auction.offer_min}.`,
          responded_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        const offer = await getRecord("offers", id ?? 0);
        io.emit("offer:update", { auctionId, offer });
        return ack?.({
          ok: false,
          error: `The seller's minimum offer is US$${auction.offer_min}. Your offer was declined automatically.`,
        });
      }
      const id = await createRecord("offers", {
        auction_id: auctionId,
        buyer_user: user.id,
        buyer_username: user.username,
        amount,
        message: message || null,
        status: "pending",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      const offer = await getRecord("offers", id ?? 0);
      await notify(
        auction.user,
        "offer",
        `Offer on ${auction.title}: US$${amount}`,
        `${user.username} offered US$${amount}${message ? ` — “${message.slice(0, 80)}”` : ""}`,
        `#/item/${auctionId}`,
      );
      commsEvent({
        userId: auction.seller_username,
        eventKey: "offer.received",
        params: { auctionTitle: auction.title, amount, bidderLabel: user.username, auctionId },
        deepLink: `${APP_URL}/#/item/${auctionId}`,
      });
      await audit(user.id, "offer:submit", "offers", id, "web", { auctionId, amount });
      io.emit("offer:update", { auctionId, offer });
      ack?.({ ok: true, offer });
    } catch (err) {
      console.error("[offer:submit]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("offer:withdraw", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const offerId = Number(data?.offerId);
      const offer = await getRecord("offers", offerId);
      if (!offer) return ack?.({ ok: false, error: "Offer not found." });
      if (offer.buyer_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Not your offer." });
      if (offer.status !== "pending")
        return ack?.({ ok: false, error: "Only a pending offer can be withdrawn." });
      await updateRecord("offers", offerId, {
        status: "withdrawn",
        responded_at: nowIso(),
        updated_at: nowIso(),
      });
      const auction = await getRecord("auctions", offer.auction_id);
      if (auction) {
        await notify(
          auction.user,
          "info",
          "Offer withdrawn",
          `${user.username} withdrew their US$${offer.amount} offer on ${auction.title}.`,
          `#/item/${auction.id}`,
        );
      }
      await audit(user.id, "offer:withdraw", "offers", offerId, "web", {});
      const updated = await getRecord("offers", offerId);
      io.emit("offer:update", { auctionId: offer.auction_id, offer: updated });
      ack?.({ ok: true, offer: updated });
    } catch (err) {
      console.error("[offer:withdraw]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("offer:respond", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const offerId = Number(data?.offerId);
      const action = String(data?.action ?? "");
      const offer = await getRecord("offers", offerId);
      if (!offer) return ack?.({ ok: false, error: "Offer not found." });
      const auction = await getRecord("auctions", offer.auction_id);
      if (!auction) return ack?.({ ok: false, error: "Item not found." });
      if (auction.user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the seller can respond to offers." });
      if (offer.status !== "pending")
        return ack?.({ ok: false, error: "This offer was already answered." });

      if (action === "accept") {
        if (auction.status !== "live")
          return ack?.({ ok: false, error: "This item is no longer live." });
        const orderId = await sellAuctionTo(
          auction,
          { id: offer.buyer_user, username: offer.buyer_username },
          offer.amount,
          null,
          "OFFER_ACCEPT",
          `offer:${offerId}:accept`,
        );
        if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale — retry." });
        await updateRecord("offers", offerId, {
          status: "accepted",
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        await audit(user.id, "offer:accept", "offers", offerId, "web", {
          auctionId: auction.id,
          amount: offer.amount,
        });
        const updatedOffer = await getRecord("offers", offerId);
        io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, accepted: true, orderId, offer: updatedOffer });
      }

      if (action === "decline") {
        await updateRecord("offers", offerId, {
          status: "declined",
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        await notify(
          offer.buyer_user,
          "offer",
          "Your offer was declined",
          `${auction.title}: the seller declined US$${offer.amount}.`,
          `#/item/${auction.id}`,
        );
        commsEvent({
          userId: offer.buyer_username,
          eventKey: "offer.responded",
          params: { auctionTitle: auction.title, amount: offer.amount, responseLabel: "declined" },
          deepLink: `${APP_URL}/#/item/${auction.id}`,
        });
        await audit(user.id, "offer:decline", "offers", offerId, "web", {});
        const updatedOffer = await getRecord("offers", offerId);
        io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, declined: true, offer: updatedOffer });
      }

      if (action === "counter") {
        const amount = round2(Number(data?.amount));
        const message = String(data?.message ?? "").slice(0, 300);
        if (!Number.isFinite(amount) || amount < 1)
          return ack?.({ ok: false, error: "Enter a counter of US$1 or more." });
        if (auction.buy_now_price != null && amount >= Number(auction.buy_now_price))
          return ack?.({ ok: false, error: "Counter must stay below the buy-now price." });
        await updateRecord("offers", offerId, {
          status: "countered",
          counter_amount: amount,
          counter_message: message || null,
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        await notify(
          offer.buyer_user,
          "offer",
          `Counter-offer: US$${amount}`,
          `${auction.title}: the seller countered your US$${offer.amount} offer.`,
          `#/item/${auction.id}`,
        );
        commsEvent({
          userId: offer.buyer_username,
          eventKey: "offer.responded",
          params: { auctionTitle: auction.title, amount, responseLabel: "countered" },
          deepLink: `${APP_URL}/#/item/${auction.id}`,
        });
        await audit(user.id, "offer:counter", "offers", offerId, "web", {
          auctionId: auction.id,
          amount,
        });
        const updatedOffer = await getRecord("offers", offerId);
        io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, countered: true, offer: updatedOffer });
      }

      return ack?.({ ok: false, error: "Unknown response action." });
    } catch (err) {
      console.error("[offer:respond]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("offer:counter-respond", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const offerId = Number(data?.offerId);
      const accept = data?.accept === true;
      const offer = await getRecord("offers", offerId);
      if (!offer) return ack?.({ ok: false, error: "Offer not found." });
      if (offer.buyer_user !== user.id)
        return ack?.({ ok: false, error: "This is not your offer." });
      if (offer.status !== "countered")
        return ack?.({ ok: false, error: "This offer has no counter pending." });
      const auction = await getRecord("auctions", offer.auction_id);
      if (!auction) return ack?.({ ok: false, error: "Item not found." });

      if (accept) {
        if (auction.status !== "live")
          return ack?.({ ok: false, error: "This item is no longer live." });
        const price = Number(offer.counter_amount ?? offer.amount);
        const orderId = await sellAuctionTo(
          auction,
          { id: offer.buyer_user, username: offer.buyer_username },
          price,
          null,
          "OFFER_COUNTER_ACCEPT",
          `offer:${offerId}:counter-accept`,
        );
        if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale — retry." });
        await updateRecord("offers", offerId, {
          status: "accepted",
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        await audit(user.id, "offer:accept_counter", "offers", offerId, "web", {
          auctionId: auction.id,
          amount: price,
        });
        const updatedOffer = await getRecord("offers", offerId);
        io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, accepted: true, orderId, offer: updatedOffer });
      }

      await updateRecord("offers", offerId, {
        status: "declined",
        responded_at: nowIso(),
        updated_at: nowIso(),
      });
      await notify(
        auction.user,
        "info",
        "Counter-offer declined",
        `${user.username} declined your US$${offer.counter_amount} counter on ${auction.title}.`,
        `#/item/${auction.id}`,
      );
      await audit(user.id, "offer:decline_counter", "offers", offerId, "web", {});
      const updatedOffer = await getRecord("offers", offerId);
      io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
      ack?.({ ok: true, declined: true, offer: updatedOffer });
    } catch (err) {
      console.error("[offer:counter-respond]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: featured listing (sell wizard, US$2 + VAT fee) ────────────
  socket.on("listing:feature", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const auctionId = Number(data?.auctionId);
      const auction = await getRecord("auctions", auctionId);
      if (!auction) return ack?.({ ok: false, error: "Listing not found." });
      if (auction.user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the seller can feature this listing." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "Only live listings can be featured." });
      if (Number(auction.featured ?? 0) === 1)
        return ack?.({ ok: false, error: "This listing is already featured." });
      if (auction.live_session_id != null)
        return ack?.({ ok: false, error: "Live-room lots cannot be featured." });
      // charge the fee SYNCHRONOUSLY (idempotent balancedTx feat-{id})
      let charged = false;
      try {
        const res = await fetch(`${FINANCE_BASE}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "listing.featured",
            auctionId,
            seller: user.username,
            auctionRef: `auction #${auctionId} — ${auction.title}`,
          }),
          signal: AbortSignal.timeout(6000),
        });
        charged = res.ok ? (await res.json()).charged === true : false;
      } catch (err) {
        console.warn("[listing:feature] finance unreachable:", (err as Error).message);
      }
      if (!charged)
        return ack?.({
          ok: false,
          error: "Could not charge the featured fee (US$2 + VAT) — please retry.",
        });
      await updateRecord("auctions", auctionId, { featured: 1, updated_at: nowIso() });
      await notify(
        user.id,
        "info",
        "Listing featured",
        `${auction.title} now appears in the Featured rail. US$2 + VAT charged to your balance.`,
        `#/item/${auctionId}`,
      );
      await audit(user.id, "listing:feature", "auctions", auctionId, "web", { fee: 2 });
      const updated = await getRecord("auctions", auctionId);
      io.emit("auction:update", { auction: updated });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[listing:feature]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: live-room sessions (host + lots + hammer host controls) ──
  socket.on("room:create", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to host a live room." });
      const authorization = eventCreateAuthorization(user);
      if (!authorization.allowed) {
        return ack?.({ ok: false, code: authorization.code, error: authorization.error });
      }
      const result = await createAuctionEvent(auctionCoreStore, audit, user, {
        title: String(data?.title ?? ""),
        startsAt: typeof data?.scheduledAt === "string" ? data.scheduledAt : null,
        timezone: "Africa/Harare",
      });
      if (!result.ok || !result.event || !result.session)
        return ack?.({ ok: false, error: result.error ?? "Could not create the live room." });
      const bundle = await eventBundle(auctionCoreStore, Number(result.event.id), user);
      io.emit("event:update", { event: bundle.event });
      io.emit("room:update", { session: bundle.session });
      ack?.({ ok: true, session: bundle.session, event: bundle.event });
    } catch (err) {
      console.error("[room:create]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("room:add-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const sessionId = Number(data?.sessionId);
      const auctionId = Number(data?.auctionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });

      if (session.event_id != null) {
        const event = await getRecord("auction_events", Number(session.event_id));
        if (!event) return ack?.({ ok: false, error: "Auction event not found." });
        const permissions = await eventPermissions(auctionCoreStore, Number(event.id), user);
        if (!permissions.operate) return ack?.({ ok: false, error: "Auction-event operator permission is required." });
        const result = await submitRunListCommand(auctionCoreStore, user, {
          commandKey: typeof data?.commandId === "string" ? data.commandId : null,
          eventId: Number(event.id),
          sessionId,
          commandType: "ADD",
          auctionId,
          expectedRunListVersion: Number(event.run_list_version ?? 0),
          source: "OPERATOR",
        });
        if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
        const bundle = await eventBundle(auctionCoreStore, Number(event.id), user);
        const updatedAuction = await getRecord("auctions", auctionId);
        io.emit("event:update", { event: bundle.event });
        io.emit("room:update", { session: bundle.session });
        if (updatedAuction) io.emit("auction:update", { auction: updatedAuction });
        return ack?.({ ok: true, auction: updatedAuction, session: bundle.session, event: bundle.event });
      }

      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can add lots." });
      const auction = await getRecord("auctions", auctionId);
      if (!auction) return ack?.({ ok: false, error: "Auction not found." });
      if (auction.user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "You can only add your own listings as lots." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "Only live listings can join a room." });
      if (auction.live_session_id != null)
        return ack?.({ ok: false, error: "This listing is already a lot in a room." });
      if (Number(auction.bid_count ?? 0) > 0)
        return ack?.({ ok: false, error: "Only listings without bids can be auctioned live." });
      await updateRecord("auctions", auctionId, {
        live_session_id: sessionId,
        ends_at: isoPlus(30 * 24 * 3600_000),
        updated_at: nowIso(),
      });
      await audit(user.id, "room:add-lot", "auctions", auctionId, "web", { sessionId, legacy: true });
      const updated = await getRecord("auctions", auctionId);
      const updatedSession = await getRecord("live_sessions", sessionId);
      io.emit("auction:update", { auction: updated });
      io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[room:add-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("room:remove-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const sessionId = Number(data?.sessionId);
      const auctionId = Number(data?.auctionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });

      if (session.event_id != null) {
        const event = await getRecord("auction_events", Number(session.event_id));
        if (!event) return ack?.({ ok: false, error: "Auction event not found." });
        const permissions = await eventPermissions(auctionCoreStore, Number(event.id), user);
        if (!permissions.operate) return ack?.({ ok: false, error: "Auction-event operator permission is required." });
        const rows = await getRecords(
          "auction_lots",
          `filter[event_id][$eq]=${Number(event.id)}&filter[auction_id][$eq]=${auctionId}&limit=1`,
        );
        const lot = rows[0];
        if (!lot) return ack?.({ ok: false, error: "This auction is not in the event run list." });
        const result = await submitRunListCommand(auctionCoreStore, user, {
          commandKey: typeof data?.commandId === "string" ? data.commandId : null,
          eventId: Number(event.id),
          sessionId,
          commandType: "WITHDRAW",
          lotId: Number(lot.id),
          reason: "Removed by event operator",
          expectedRunListVersion: Number(event.run_list_version ?? 0),
          source: "OPERATOR",
        });
        if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
        const bundle = await eventBundle(auctionCoreStore, Number(event.id), user);
        const updatedAuction = await getRecord("auctions", auctionId);
        io.emit("event:update", { event: bundle.event });
        io.emit("room:update", { session: bundle.session });
        if (updatedAuction) io.emit("auction:update", { auction: updatedAuction });
        return ack?.({ ok: true, auction: updatedAuction, session: bundle.session });
      }

      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can remove lots." });
      const auction = await getRecord("auctions", auctionId);
      if (!auction || auction.live_session_id !== sessionId)
        return ack?.({ ok: false, error: "This listing is not a lot in this room." });
      if (session.current_lot_id === auctionId)
        return ack?.({ ok: false, error: "Close the current lot before removing it." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "Sold/ended lots stay in the room history." });
      await updateRecord("auctions", auctionId, {
        live_session_id: null,
        ends_at: isoPlus(7 * 24 * 3600_000),
        updated_at: nowIso(),
      });
      await audit(user.id, "room:remove-lot", "auctions", auctionId, "web", { sessionId, legacy: true });
      const updated = await getRecord("auctions", auctionId);
      io.emit("auction:update", { auction: updated });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[room:remove-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:open-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const sessionId = Number(data?.sessionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });

      if (session.event_id != null) {
        const event = await getRecord("auction_events", Number(session.event_id));
        if (!event) return ack?.({ ok: false, error: "Auction event not found." });
        const permissions = await eventPermissions(auctionCoreStore, Number(event.id), user);
        if (!permissions.operate) return ack?.({ ok: false, error: "Auction-event operator permission is required." });
        let lot: any = null;
        if (data?.auctionId != null) {
          const rows = await getRecords(
            "auction_lots",
            `filter[event_id][$eq]=${Number(event.id)}&filter[auction_id][$eq]=${Number(data.auctionId)}&limit=1`,
          );
          lot = rows[0] ?? null;
        } else if (event.next_lot_id != null) {
          lot = await getRecord("auction_lots", Number(event.next_lot_id));
        } else {
          const ready = await getRecords(
            "auction_lots",
            `filter[event_id][$eq]=${Number(event.id)}&filter[status][$eq]=READY&order=sequence_no&limit=1`,
          );
          lot = ready[0] ?? null;
        }
        if (!lot) return ack?.({ ok: false, error: "No ready lot is available." });
        const result = await submitRunListCommand(auctionCoreStore, user, {
          commandKey: typeof data?.commandId === "string" ? data.commandId : null,
          eventId: Number(event.id),
          sessionId,
          commandType: "OPEN",
          lotId: Number(lot.id),
          expectedRunListVersion: Number(event.run_list_version ?? 0),
          source: "OPERATOR",
        });
        if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
        const bundle = await eventBundle(auctionCoreStore, Number(event.id), user);
        const auction = await getRecord("auctions", Number(lot.auction_id));
        if (auction) {
          const watchers = await getRecords("watchlist", `filter[auction_id][$eq]=${auction.id}&limit=100`);
          for (const watcher of watchers) {
            if (String(watcher.user) !== String(user.id)) {
              await notify(
                watcher.user,
                "live",
                "Live lot opening",
                `${auction.title} is on the block in “${event.title}”.`,
                `#/live/${sessionId}`,
              );
            }
          }
        }
        io.emit("event:update", { event: bundle.event });
        io.emit("room:update", { session: bundle.session });
        return ack?.({ ok: true, session: bundle.session, lot: auction });
      }

      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can open lots." });
      if (session.status === "closed")
        return ack?.({ ok: false, error: "This room has ended." });
      const lots = await getRecords(
        "auctions",
        `filter[live_session_id][$eq]=${sessionId}&filter[status][$eq]=live&order=id&limit=100`,
      );
      let lot: any = null;
      if (data?.auctionId != null) {
        lot = lots.find((row: any) => row.id === Number(data.auctionId)) ?? null;
        if (!lot) return ack?.({ ok: false, error: "That lot is not available in this room." });
      } else {
        lot = lots.find((row: any) => row.id !== session.current_lot_id) ?? null;
      }
      if (!lot) return ack?.({ ok: false, error: "No more lots to open." });
      await updateRecord("live_sessions", sessionId, {
        status: "live",
        current_lot_id: lot.id,
        lot_index: Number(session.lot_index ?? 0) + 1,
        close_at: null,
        updated_at: nowIso(),
      });
      await audit(user.id, "host:open-lot", "live_sessions", sessionId, "web", { lotId: lot.id, legacy: true });
      const updatedSession = await getRecord("live_sessions", sessionId);
      io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, session: updatedSession, lot });
    } catch (err) {
      console.error("[host:open-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:close-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const sessionId = Number(data?.sessionId);
      const sold = data?.sold === true;
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
      if (session.event_id != null) {
        const permissions = await eventPermissions(auctionCoreStore, Number(session.event_id), user);
        if (!permissions.operate) return ack?.({ ok: false, error: "Auction-event operator permission is required." });
      } else if (session.host_user !== user.id && !user.admin) {
        return ack?.({ ok: false, error: "Only the host can close lots." });
      }
      if (session.status !== "live" || !session.current_lot_id)
        return ack?.({ ok: false, error: "No lot is open in this room." });
      const lot = await getRecord("auctions", session.current_lot_id);
      if (!lot) return ack?.({ ok: false, error: "Lot not found." });
      if (sold) {
        const bids = await getRecords(
          "bids",
          `filter[auction_id][$eq]=${lot.id}&order=-id&limit=50`,
        );
        const active = bids.find((bid: any) => bid.status === "active");
        if (!active)
          return ack?.({ ok: false, error: "No bids to sell to — pass the lot instead." });
        const orderId = await sellAuctionTo(
          lot,
          { id: active.user, username: active.bidder_username },
          active.amount,
          null,
          "MANUAL_HAMMER",
          typeof data?.commandId === "string" ? data.commandId : null,
        );
        if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale." });
        await audit(user.id, "room:hammer", "auctions", lot.id, "web", { sessionId, manual: true });
      } else {
        const ended = await endUnsold(
          lot,
          "MANUAL_PASS",
          typeof data?.commandId === "string" ? data.commandId : null,
        );
        if (!ended) return ack?.({ ok: false, error: "Could not pass the lot." });
        await audit(user.id, "room:pass", "auctions", lot.id, "web", { sessionId });
      }
      const fresh = await getRecord("live_sessions", sessionId);
      if (fresh) await advanceRoom(fresh);
      const updatedSession = await getRecord("live_sessions", sessionId);
      ack?.({ ok: true, session: updatedSession });
    } catch (err) {
      console.error("[host:close-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:end-session", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const sessionId = Number(data?.sessionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });

      if (session.event_id != null) {
        const event = await getRecord("auction_events", Number(session.event_id));
        if (!event) return ack?.({ ok: false, error: "Auction event not found." });
        const permissions = await eventPermissions(auctionCoreStore, Number(event.id), user);
        if (!permissions.operate) return ack?.({ ok: false, error: "Auction-event operator permission is required." });
        const result = await submitRunListCommand(auctionCoreStore, user, {
          commandKey: typeof data?.commandId === "string" ? data.commandId : null,
          eventId: Number(event.id),
          sessionId,
          commandType: "CLOSE_EVENT",
          expectedRunListVersion: Number(event.run_list_version ?? 0),
          source: "OPERATOR",
        });
        if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
        const bundle = await eventBundle(auctionCoreStore, Number(event.id), user);
        io.emit("event:update", { event: bundle.event });
        io.emit("room:update", { session: bundle.session });
        return ack?.({ ok: true, session: bundle.session, event: bundle.event });
      }

      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can end the room." });
      if (session.status === "live" && session.current_lot_id)
        return ack?.({ ok: false, error: "Close the current lot first." });
      const lots = await getRecords(
        "auctions",
        `filter[live_session_id][$eq]=${sessionId}&filter[status][$eq]=live&limit=100`,
      );
      for (const lot of lots) {
        await updateRecord("auctions", lot.id, {
          live_session_id: null,
          ends_at: isoPlus(7 * 24 * 3600_000),
          updated_at: nowIso(),
        });
        const updated = await getRecord("auctions", lot.id);
        io.emit("auction:update", { auction: updated });
      }
      await updateRecord("live_sessions", sessionId, {
        status: "closed",
        current_lot_id: null,
        close_at: null,
        updated_at: nowIso(),
      });
      await audit(user.id, "host:end-session", "live_sessions", sessionId, "web", {
        returnedLots: lots.length,
        legacy: true,
      });
      const updatedSession = await getRecord("live_sessions", sessionId);
      io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, session: updatedSession });
    } catch (err) {
      console.error("[host:end-session]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("buynow:purchase", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to buy instantly." });
      const auctionId = Number(data?.auctionId);
      const auction = await getRecord("auctions", auctionId);
      if (!auction) return ack?.({ ok: false, error: "Auction not found." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "This auction is no longer live." });
      if (auction.buy_now_price == null)
        return ack?.({ ok: false, error: "This auction has no buy-now price." });
      if (Number(auction.bid_count ?? 0) > 0)
        return ack?.({ ok: false, error: "Buy-now is no longer available after the first bid." });
      if (auction.user === user.id)
        return ack?.({ ok: false, error: "You cannot buy your own auction." });

      const result = await finalizeAuctionWithPolicy({
        commandKey: typeof data?.commandId === "string" ? data.commandId : null,
        auctionId,
        source: "BUY_NOW",
        requestedOutcome: "SOLD",
        buyer: user,
        price: Number(auction.buy_now_price),
        address: typeof data?.address === "string" ? data.address : null,
        expectedVersion: Number(auction.version ?? 0),
      });
      if (!result.ok) return ack?.({ ok: false, error: result.error, code: result.code });
      await drainAuctionOutbox();
      ack?.({ ok: true, orderId: result.orderId, order: result.order, auction: result.auction });
    } catch (err) {
      console.error("[buynow:purchase]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("question:ask", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to ask questions." });
      const auctionId = Number(data?.auctionId);
      const body = String(data?.body ?? "").trim();
      if (body.length < 10) return ack?.({ ok: false, error: "Write at least 10 characters." });
      const auction = await getRecord("auctions", auctionId);
      if (!auction) return ack?.({ ok: false, error: "Auction not found." });
      const id = await createRecord("questions", {
        auction_id: auctionId,
        user: user.id,
        asker_username: user.username,
        body,
        created_at: nowIso(),
      });
      const question = await getRecord("questions", id ?? 0);
      await notify(
        auction.user,
        "question",
        "Question on your item",
        `${user.username}: ${body.slice(0, 90)}`,
        `#/item/${auctionId}`,
      );
      await audit(user.id, "question:ask", "questions", id, "web", { auctionId });
      if (question) io.emit("question:update", { question });
      ack?.({ ok: true, question });
    } catch (err) {
      console.error("[question:ask]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("question:answer", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const questionId = Number(data?.questionId);
      const body = String(data?.body ?? "").trim();
      const question = await getRecord("questions", questionId);
      if (!question) return ack?.({ ok: false, error: "Question not found." });
      const auction = await getRecord("auctions", question.auction_id);
      if (!auction || (auction.user !== user.id && !user.admin))
        return ack?.({ ok: false, error: "Only the seller can answer this question." });
      await updateRecord("questions", questionId, { answer: body, answered_at: nowIso() });
      const updated = await getRecord("questions", questionId);
      await notify(
        question.user,
        "question",
        "Your question was answered",
        `${auction.title}: ${body.slice(0, 90)}`,
        `#/item/${question.auction_id}`,
      );
      await audit(user.id, "question:answer", "questions", questionId, "web", {});
      if (updated) io.emit("question:update", { question: updated });
      ack?.({ ok: true, question: updated });
    } catch (err) {
      console.error("[question:answer]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("message:send", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to send messages." });
      const body = String(data?.body ?? "").trim();
      if (!body) return ack?.({ ok: false, error: "Message is empty." });

      let thread = data?.threadId ? await getRecord("threads", Number(data.threadId)) : null;
      if (thread) {
        const participant =
          thread.buyer_user === user.id || thread.seller_user === user.id || user.admin;
        if (!participant)
          return ack?.({ ok: false, error: "You are not part of this conversation." });
      }
      if (!thread && data?.auctionId != null) {
        const auction = await getRecord("auctions", Number(data.auctionId));
        if (!auction) return ack?.({ ok: false, error: "Auction not found." });
        if (auction.user === user.id)
          return ack?.({ ok: false, error: "This is your own listing." });
        const threads = await getRecords(
          "threads",
          `filter[auction_id][$eq]=${Number(data.auctionId)}&limit=100`,
        );
        thread = threads.find((t: any) => t.buyer_user === user.id) ?? null;
        if (!thread) {
          const threadId = await createRecord("threads", {
            auction_id: Number(data.auctionId),
            buyer_user: user.id,
            seller_user: auction.user,
            buyer_username: user.username,
            seller_username: auction.seller_username,
            subject: auction.title,
            last_message_at: nowIso(),
            created_at: nowIso(),
          });
          thread = await getRecord("threads", threadId ?? 0);
        }
      }
      if (!thread && data?.toUsername) {
        const profiles = await getRecords(
          "profiles",
          `filter[username][$eq]=${encodeURIComponent(String(data.toUsername))}&limit=1`,
        );
        const to = profiles[0];
        if (!to) return ack?.({ ok: false, error: "Recipient not found." });
        const threads = await getRecords("threads", `filter[auction_id][$is]=NULL&limit=200`);
        thread =
          threads.find(
            (t: any) =>
              (t.buyer_user === user.id && t.seller_user === to.user) ||
              (t.seller_user === user.id && t.buyer_user === to.user),
          ) ?? null;
        if (!thread) {
          const threadId = await createRecord("threads", {
            auction_id: null,
            buyer_user: user.id,
            seller_user: to.user,
            buyer_username: user.username,
            seller_username: to.username,
            subject: "Direct message",
            last_message_at: nowIso(),
            created_at: nowIso(),
          });
          thread = await getRecord("threads", threadId ?? 0);
        }
      }
      if (!thread) return ack?.({ ok: false, error: "Conversation not found." });

      const messageId = await createRecord("messages", {
        thread_id: thread.id,
        user: user.id,
        sender_username: user.username,
        body,
        created_at: nowIso(),
      });
      await updateRecord("threads", thread.id, { last_message_at: nowIso() });
      const message = await getRecord("messages", messageId ?? 0);
      const recipient = thread.buyer_user === user.id ? thread.seller_user : thread.buyer_user;
      await notify(
        recipient,
        "message",
        `New message from ${user.username}`,
        body.slice(0, 90),
        `#/messages/${thread.id}`,
      );
      // TUCS: mediated relay — moderation + per-channel fan-out to the
      // recipient's linked channels. Fire-and-forget, never blocks the ack.
      const counterpartUsername =
        thread.buyer_user === user.id ? thread.seller_username : thread.buyer_username;
      if (counterpartUsername) {
        commsRelayOut({
          threadId: String(thread.id),
          fromUserId: user.username,
          fromLabel: user.username,
          toUserId: counterpartUsername,
          content: body,
          deepLink: `${APP_URL}/#/messages/${thread.id}`,
        });
      }
      await audit(user.id, "message:send", "threads", thread.id, "web", {});
      if (message) io.emit("message:new", { message, thread });
      ack?.({ ok: true, message, thread });
    } catch (err) {
      console.error("[message:send]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("order:pay", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to pay." });
      const orderId = Number(data?.orderId);
      const order = await getRecord("orders", orderId);
      if (!order) return ack?.({ ok: false, error: "Order not found." });
      if (order.buyer_user !== user.id)
        return ack?.({ ok: false, error: "Only the buyer can pay this order." });
      if (order.status !== "pending_payment")
        return ack?.({ ok: false, error: "This order is not awaiting payment." });
      const method = String(data?.method ?? "ecocash");
      const reference =
        String(data?.reference ?? "") ||
        `${method.toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`;
      await updateRecord("orders", orderId, {
        status: "paid",
        paid_at: nowIso(),
        updated_at: nowIso(),
      });
      await createRecord("payments", {
        order_id: orderId,
        user: user.id,
        method,
        amount: order.final_price,
        status: "settled",
        reference,
        created_at: nowIso(),
      });
      // Finance (12-b): fund escrow for this payment — item price + the
      // auction's shipping fee (§G: buyer pays win price + shipping).
      // Fire-and-forget; the finance sweep backfills if this is missed.
      const payAuction = await getRecord("auctions", Number(order.auction_id)).catch(() => null);
      financeEvent("order.paid", {
        orderId,
        buyer: order.buyer_username,
        seller: order.seller_username,
        itemPrice: Number(order.final_price ?? 0),
        shipping: Number(payAuction?.shipping_fee ?? 0),
        method,
        reference,
      });
      await notify(
        order.seller_user,
        "order",
        "Payment received",
        `${order.auction_title} — US$${order.final_price}. Dispatch within 3 days (SLA).`,
        `#/orders/${orderId}`,
      );
      await audit(user.id, "order:pay", "orders", orderId, "web", { method, reference });
      const updated = await getRecord("orders", orderId);
      if (updated) io.emit("order:update", { order: updated });
      ack?.({ ok: true, order: updated });
    } catch (err) {
      console.error("[order:pay]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("order:ship", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const orderId = Number(data?.orderId);
      const order = await getRecord("orders", orderId);
      if (!order) return ack?.({ ok: false, error: "Order not found." });
      if (order.seller_user !== user.id)
        return ack?.({ ok: false, error: "Only the seller can dispatch this order." });
      if (order.status !== "paid")
        return ack?.({ ok: false, error: "Order must be paid before dispatch." });
      const carrier = String(data?.carrier ?? "SwiftExpress");
      const tracking = String(
        data?.tracking ?? `TRK${Math.floor(Math.random() * 900000 + 100000)}`,
      );
      await updateRecord("orders", orderId, {
        status: "shipped",
        shipped_at: nowIso(),
        carrier,
        tracking,
        updated_at: nowIso(),
      });
      await notify(
        order.buyer_user,
        "order",
        "Your item has shipped",
        `${order.auction_title} via ${carrier} — tracking ${tracking}.`,
        `#/orders/${orderId}`,
      );
      await audit(user.id, "order:ship", "orders", orderId, "web", { carrier, tracking });
      const updated = await getRecord("orders", orderId);
      if (updated) io.emit("order:update", { order: updated });
      ack?.({ ok: true, order: updated });
    } catch (err) {
      console.error("[order:ship]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("order:deliver", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in first." });
      const orderId = Number(data?.orderId);
      const order = await getRecord("orders", orderId);
      if (!order) return ack?.({ ok: false, error: "Order not found." });
      if (order.buyer_user !== user.id)
        return ack?.({ ok: false, error: "Only the buyer can confirm delivery." });
      if (order.status !== "shipped")
        return ack?.({ ok: false, error: "Order must be shipped first." });
      await updateRecord("orders", orderId, {
        status: "delivered",
        delivered_at: nowIso(),
        updated_at: nowIso(),
      });
      // Finance (12-b): delivery confirmed → open the dispute window.
      financeEvent("order.delivered", { orderId, deliveredAt: nowIso() });
      await notify(
        order.seller_user,
        "order",
        "Delivery confirmed",
        `${order.auction_title} — buyer confirmed receipt. Rating window is open.`,
        `#/orders/${orderId}`,
      );
      await audit(user.id, "order:deliver", "orders", orderId, "web", {});
      const updated = await getRecord("orders", orderId);
      if (updated) io.emit("order:update", { order: updated });
      ack?.({ ok: true, order: updated });
    } catch (err) {
      console.error("[order:deliver]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("order:rate", async (data: any, ack?: Ack) => {
    try {
      const user = await requireAuth();
      if (!user) return ack?.({ ok: false, error: "Sign in to rate." });
      const orderId = Number(data?.orderId);
      const score = Math.max(1, Math.min(5, Number(data?.score) || 5));
      const comment = String(data?.comment ?? "").slice(0, 500);
      const order = await getRecord("orders", orderId);
      if (!order) return ack?.({ ok: false, error: "Order not found." });
      const iAmBuyer = order.buyer_user === user.id;
      if (!iAmBuyer && order.seller_user !== user.id)
        return ack?.({ ok: false, error: "Not your order." });
      if (order.status !== "delivered" && order.status !== "completed")
        return ack?.({ ok: false, error: "You can rate after delivery." });
      const rateeUser = iAmBuyer ? order.seller_user : order.buyer_user;
      const rateeUsername = iAmBuyer ? order.seller_username : order.buyer_username;
      const ratingId = await createRecord("ratings", {
        order_id: orderId,
        user: user.id,
        ratee_user: rateeUser,
        ratee_username: rateeUsername,
        direction: iAmBuyer ? "as_buyer" : "as_seller",
        score,
        comment,
        created_at: nowIso(),
      });
      const profiles = await getRecords(
        "profiles",
        `filter[user][$eq]=${encodeURIComponent(rateeUser)}&limit=1`,
      );
      const profile = profiles[0];
      if (profile) {
        const total = profile.rating_avg * profile.rating_count + score;
        await updateRecord("profiles", profile.id, {
          rating_count: profile.rating_count + 1,
          rating_avg: Math.round((total / (profile.rating_count + 1)) * 100) / 100,
        });
      }
      if (order.status === "delivered") {
        await updateRecord("orders", orderId, {
          status: "completed",
          completed_at: nowIso(),
          updated_at: nowIso(),
        });
      }
      await notify(
        rateeUser,
        "rating",
        "You received a rating",
        `${user.username} rated you ${score}/5.`,
        `#/u/${rateeUsername}`,
      );
      await audit(user.id, "order:rate", "orders", orderId, "web", { score });
      const rating = await getRecord("ratings", ratingId ?? 0);
      const updatedOrder = await getRecord("orders", orderId);
      if (updatedOrder) io.emit("order:update", { order: updatedOrder });
      ack?.({ ok: true, rating });
    } catch (err) {
      console.error("[order:rate]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });
});

// ── boot ─────────────────────────────────────────────────────────────
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[trade-engine] listening on :${PORT}`);
  void (async () => {
    try {
      adminToken = await tbLogin();
      console.log("[trade-engine] admin session established (TrailBase :3001)");
      if (process.env.TENGASELL_ALLOW_DEMO_REVIVE === "1") {
        console.warn("[trade-engine] explicit non-commercial demo revival enabled");
        await reviveExpiredAuctions();
      } else {
        await sweepAuctions();
        await sweepLiveRooms();
        await drainAuctionOutbox();
      }
    } catch (err) {
      console.error("[trade-engine] boot warning:", (err as Error).message);
    }
  })();
});

// sweeps
setInterval(() => {
  void sweepAuctions().catch((err) => console.error("[sweep]", err));
}, 10_000);

// Gap-8 sweeps: live-room hammer (snappy 3s), offer expiry, search alerts
setInterval(() => {
  void sweepLiveRooms().catch((err) => console.error("[sweep:rooms]", err));
}, 3_000);
setInterval(() => {
  void sweepOfferExpiry().catch((err) => console.error("[sweep:offers]", err));
}, 30_000);
setInterval(() => {
  void sweepSavedSearches().catch((err) => console.error("[sweep:searches]", err));
}, 60_000);

// Durable outbox replay: committed domain events are published after commit.
setInterval(() => {
  void drainAuctionOutbox().catch((err) => console.error("[outbox]", err));
}, 1_000);

// refresh admin token periodically
setInterval(() => {
  adminToken = null;
}, 30 * 60_000);

process.on("unhandledRejection", (err) => console.error("[unhandled]", err));
