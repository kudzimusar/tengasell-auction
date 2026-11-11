// Tengasell trade engine — socket.io RPC service (port 3002).
//
// Authoritative server-side implementation of marketplace rules, writing to
// the TrailBase (Rust) backend on port 3001 with an admin token:
//   · Yahoo Auctions-style proxy (automatic) bidding
//   · anti-snipe soft close (final 5 min → +5 min, max 15 extensions)
//   · buy-now reservation + orders with 48h payment SLA
//   · Q&A, messaging, notifications, ratings, audit trail (web/agent/mcp)
//
// RPC events (client → server, with ack):
//   bid:place {auctionId, maxAmount}
//   bid:retract {bidId, reason}                    ← Gap-8: 60-min window, lead bid only
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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import {
  IdentityResolver,
  openCanonicalTrailBaseStore,
  openRevocationStore,
  parseStrictJwt,
  resolveTrailBaseDataDir,
  sha256Hex,
  timingSafeEqualStr,
  type AuthResolution,
  type Identity,
} from "./auth";
import {
  BidService,
  bidIncrement,
  isoPlus,
  nowIso,
  preCommitError,
  round2,
  uncertainBidOutcome,
  type BidOutcome,
} from "./bidding";

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? process.env.TRADE_ENGINE_PORT ?? 3002);
const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
const INTERNAL_SECRET = (process.env.TGS_INTERNAL_SECRET ?? "").trim();
const AUTH_CACHE_TTL_MS = Number(process.env.TRADE_AUTH_CACHE_TTL_MS ?? 5_000);

// RPC acknowledgement callback shape (client → server events respond with
// a single JSON payload, e.g. { ok: false, error: "..." } or { ok: true, ... }).
type Ack = (response: unknown) => void;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// ── TrailBase REST helpers ───────────────────────────────────────────
let adminToken: string | null = null;
let adminTokenExpMs = 0;
let adminLoginPromise: Promise<string> | null = null;

function readAdminTokenExpMs(token: string): number {
  const claims = parseStrictJwt(token);
  return claims ? claims.exp * 1000 : Date.now() + 3600_000;
}

async function tbLogin(): Promise<string> {
  if (!ADMIN_PASSWORD) {
    throw new Error("admin login failed: ADMIN_PASSWORD environment variable is not set");
  }
  const res = await fetch(`${TRAILBASE}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  const data = (await res.json()) as { auth_token?: unknown };
  if (typeof data?.auth_token !== "string" || !data.auth_token) {
    throw new Error("admin login failed: missing auth_token");
  }
  return data.auth_token;
}

async function ensureAdminToken(force = false): Promise<string> {
  const expiringSoon = !adminToken || adminTokenExpMs - Date.now() <= 30_000;
  if (!force && adminToken && !expiringSoon) {
    return adminToken;
  }
  if (!adminLoginPromise || force) {
    if (force) {
      adminToken = null;
      adminTokenExpMs = 0;
    }
    const pendingLogin = tbLogin()
      .then((tok) => {
        adminToken = tok;
        adminTokenExpMs = readAdminTokenExpMs(tok);
        return tok;
      })
      .finally(() => {
        if (adminLoginPromise === pendingLogin) {
          adminLoginPromise = null;
        }
      });
    adminLoginPromise = pendingLogin;
  }
  return adminLoginPromise;
}

export interface TbResult {
  ok: boolean;
  status: number;
  data: any;
  transportError?: boolean;
  malformed?: boolean;
  errorMessage?: string;
}

/** One TrailBase request, with a single 401/403 retry (TrailBase v0.35 returns 403
 *  as well as 401 on expired admin bearer tokens). Transport drops never throw
 *  unexpectedly; callers inspect `ok`/`status`/`transportError`. */
async function tb(
  method: string,
  path: string,
  body?: unknown,
): Promise<TbResult> {
  const call = async (token: string): Promise<TbResult> => {
    try {
      const res = await fetch(`${TRAILBASE}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      let data: any = null;
      let malformed = false;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          malformed = res.ok;
        }
      }
      return { ok: res.ok && !malformed, status: res.status, data, ...(malformed ? { malformed: true } : {}) };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: null,
        transportError: true,
        errorMessage: (err as Error)?.message ?? "TrailBase request failed",
      };
    }
  };

  let token: string;
  try {
    token = await ensureAdminToken();
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      transportError: true,
      errorMessage: (err as Error)?.message ?? "admin login failed",
    };
  }

  let result = await call(token);
  if (result.status === 401 || result.status === 403) {
    try {
      const freshToken = await ensureAdminToken(true);
      result = await call(freshToken);
    } catch (err) {
      return {
        ok: false,
        status: result.status,
        data: null,
        transportError: true,
        errorMessage: (err as Error)?.message ?? "admin re-login failed",
      };
    }
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

// ── socket identity ──────────────────────────────────────────────────
const trailBaseDataDir = resolveTrailBaseDataDir(ENGINE_DIR);
const requireSessionDb =
  process.env.TRAILBASE_REQUIRE_SESSION_DB === "1" || process.env.NODE_ENV === "production";
if (requireSessionDb && !trailBaseDataDir) {
  throw new Error(
    "[trade-engine] TRAILBASE_DATA_DIR is required for canonical _session verification",
  );
}
const canonicalStore = trailBaseDataDir ? openCanonicalTrailBaseStore(trailBaseDataDir) : null;
const revocationsDbPath =
  process.env.TGS_REVOCATIONS_DB ??
  (trailBaseDataDir ? path.join(trailBaseDataDir, "tgs_revocations.db") : null);
const revocationStore = revocationsDbPath ? openRevocationStore(revocationsDbPath) : undefined;

const authResolver = new IdentityResolver({
  cacheTtlMs: AUTH_CACHE_TTL_MS,
  checkCanonicalUserSession: canonicalStore ? canonicalStore.check : undefined,
  revocationStore,
  fetchStatus: async (token: string) => {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, status: res.status, authToken: null };
    const data = (await res.json().catch(() => null)) as { auth_token?: unknown } | null;
    const authToken = typeof data?.auth_token === "string" ? data.auth_token : null;
    return { ok: true, status: res.status, authToken };
  },
  lookupProfile: async (sub: string, _username: string) => {
    const res = await tb(
      "GET",
      `/api/records/v1/profiles?filter[user][$eq]=${encodeURIComponent(sub)}&limit=1`,
    );
    if (!res.ok) {
      throw new Error(
        `profile lookup failed: HTTP ${res.status} (${res.errorMessage ?? "error"})`,
      );
    }
    const profiles = Array.isArray(res.data?.records) ? res.data.records : [];
    const p = profiles[0];
    if (!p || typeof p.user !== "string" || !p.user || typeof p.username !== "string") {
      return null;
    }
    return { user: p.user, username: p.username };
  },
});

// ── notifications + audit (strictly non-throwing post-commit helpers) ─
async function notify(
  user: string,
  type: string,
  title: string,
  body: string,
  link: string,
): Promise<boolean> {
  if (!user) return true;
  try {
    const id = await createRecord("notifications", {
      user,
      type,
      title,
      body,
      link,
      read: 0,
      created_at: nowIso(),
    });
    if (id == null) {
      console.warn(`[notify] failed to persist notification for ${user} (${type})`);
      return false;
    }
    const notification = { id, user, type, title, body, link, read: 0, created_at: nowIso() };
    io.to(`user:${user}`).emit("notification:new", { notification });
    return true;
  } catch (err) {
    console.warn("[notify] unexpected error:", (err as Error)?.message ?? err);
    return false;
  }
}

async function audit(
  user: string | null,
  action: string,
  entity: string,
  entityId: number | null,
  source: string,
  payload: unknown,
): Promise<boolean> {
  try {
    const id = await createRecord("audit_events", {
      user,
      action,
      entity,
      entity_id: entityId,
      source,
      payload: JSON.stringify(payload ?? {}),
      created_at: nowIso(),
    });
    if (id == null) {
      console.warn(`[audit] failed to record ${action} (${entity}:${entityId})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[audit] unexpected error recording ${action}:`, (err as Error)?.message ?? err);
    return false;
  }
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
async function antiSnipeOutcome(
  auctionId: number,
): Promise<{ auction: any | null; warning?: string }> {
  const auctionRes = await tb("GET", `/api/records/v1/auctions/${auctionId}`);
  if (!auctionRes.ok || !auctionRes.data) {
    return { auction: null, warning: "anti_snipe_failed" };
  }
  const auction = auctionRes.data;
  if (auction.status !== "live") return { auction };
  const remaining = Date.parse(auction.ends_at) - Date.now();
  if (remaining < 5 * 60_000 && Number(auction.extension_count ?? 0) < 15) {
    const newEnds = isoPlus(5 * 60_000 + Math.max(remaining, 0));
    const patchRes = await tb("PATCH", `/api/records/v1/auctions/${auctionId}`, {
      ends_at: newEnds,
      extension_count: Number(auction.extension_count ?? 0) + 1,
      updated_at: nowIso(),
    });
    if (!patchRes.ok) {
      return { auction, warning: "anti_snipe_failed" };
    }
    const refreshed = await tb("GET", `/api/records/v1/auctions/${auctionId}`);
    if (!refreshed.ok || !refreshed.data) {
      return {
        auction: {
          ...auction,
          ends_at: newEnds,
          extension_count: Number(auction.extension_count ?? 0) + 1,
        },
        warning: "auction_read_failed",
      };
    }
    return { auction: refreshed.data };
  }
  return { auction };
}

async function notifyWatchers(auction: any, bidder: Identity, price: number): Promise<boolean> {
  try {
    const watchers = await getRecords(
      "watchlist",
      `filter[auction_id][$eq]=${auction.id}&limit=100`,
    );
    let allOk = true;
    for (const w of watchers) {
      if (w.user === bidder.id) continue;
      const ok = await notify(
        w.user,
        "bid",
        "New bid on your watchlist",
        `${bidder.username} bid US$${price} on ${auction.title}.`,
        `#/item/${auction.id}`,
      );
      if (!ok) allOk = false;
    }
    return allOk;
  } catch {
    return false;
  }
}

const bidService = new BidService({
  getAuction: async (auctionId) => {
    const res = await tb("GET", `/api/records/v1/auctions/${auctionId}`);
    if (res.ok && res.data) return { ok: true, row: res.data };
    return {
      ok: false,
      notFound: res.status === 404,
      error: res.errorMessage ?? `HTTP ${res.status}`,
    };
  },
  listBids: async (auctionId) => {
    const res = await tb(
      "GET",
      `/api/records/v1/bids?filter[auction_id][$eq]=${auctionId}&order=-id&limit=50`,
    );
    if (!res.ok) return { ok: false, error: res.errorMessage ?? `HTTP ${res.status}` };
    return { ok: true, rows: res.data?.records ?? [] };
  },
  createBid: async (row) => {
    const res = await tb("POST", "/api/records/v1/bids", row);
    if (res.ok) {
      const id = res.data?.ids?.[0];
      if (id != null && Number.isFinite(Number(id))) {
        return { status: "created", id: Number(id) };
      }
      // 200 OK without a parsable record id is ambiguous — never assert non-commit.
      return { status: "uncertain", error: "Malformed bid insert confirmation" };
    }
    if (res.transportError || res.malformed || res.status === 502 || res.status === 504) {
      return { status: "uncertain", error: res.errorMessage ?? `HTTP ${res.status}` };
    }
    return { status: "rejected", statusCode: res.status };
  },
  patchBid: async (bidId, patch) => updateRecord("bids", bidId, patch),
  patchAuction: async (auctionId, patch) => updateRecord("auctions", auctionId, patch),
  extendLiveRoom: async (liveSessionId) => {
    const patchRes = await tb("PATCH", `/api/records/v1/live_sessions/${liveSessionId}`, {
      close_at: isoPlus(20_000),
      updated_at: nowIso(),
    });
    if (!patchRes.ok) return { session: null, warning: "room_extend_failed" };
    const session = await getRecord("live_sessions", liveSessionId);
    return { session, ...(!session ? { warning: "room_read_failed" } : {}) };
  },
  antiSnipe: antiSnipeOutcome,
  notifyBestEffort: notify,
  notifyWatchersBestEffort: notifyWatchers,
  commsOutbidBestEffort: ({ userId, auctionTitle, amount, bidderLabel, auctionId }) => {
    commsEvent({
      userId,
      eventKey: "auction.outbid",
      params: { auctionTitle, amount, bidderLabel, auctionId },
      deepLink: `${APP_URL}/#/item/${auctionId}`,
    });
  },
  auditBestEffort: audit,
  emitRoomUpdate: (session) => {
    io.emit("room:update", { session });
  },
  emitAuctionUpdate: (auction) => {
    io.emit("auction:update", { auction });
  },
});

// ── Gap-8 shared sale helper (offers accept + live-room hammer) ───────
// Marks the auction sold, creates the 48h-SLA order, notifies both
// parties in-app and cross-channel (TUCS auction.won/auction.sold),
// and broadcasts the order. Returns the order id (null = write failed).
async function sellAuctionTo(
  auction: any,
  buyer: { id: string; username: string },
  price: number,
  address?: string | null,
): Promise<number | null> {
  const soldOk = await updateRecord("auctions", auction.id, { status: "sold", updated_at: nowIso() });
  if (!soldOk) {
    console.error(`[sellAuctionTo] failed to mark auction ${auction.id} sold`);
    return null;
  }
  const orderId = await createRecord("orders", {
    auction_id: auction.id,
    auction_title: auction.title,
    buyer_user: buyer.id,
    seller_user: auction.user,
    buyer_username: buyer.username,
    seller_username: auction.seller_username,
    final_price: round2(price),
    ...(address ? { address: address.slice(0, 200) } : {}),
    status: "pending_payment",
    pay_by: isoPlus(48 * 3600_000),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (orderId == null) {
    const reverted = await updateRecord("auctions", auction.id, { status: "live", updated_at: nowIso() });
    if (!reverted) {
      console.error(`[sellAuctionTo] failed to roll back auction ${auction.id} after order insert error`);
    }
    return null;
  }
  await notify(
    buyer.id,
    "won",
    "You won — payment due",
    `${auction.title} at US$${round2(price)}. Complete payment within 48h (SLA).`,
    `#/orders/${orderId}`,
  );
  await notify(
    auction.user,
    "sold",
    "Your auction sold",
    `${auction.title} — US$${round2(price)} to ${buyer.username}.`,
    `#/orders/${orderId}`,
  );
  commsEvent({
    userId: buyer.username,
    eventKey: "auction.won",
    params: { auctionTitle: auction.title, amount: round2(price), auctionId: auction.id },
    deepLink: `${APP_URL}/#/item/${auction.id}`,
  });
  if (auction.seller_username) {
    commsEvent({
      userId: auction.seller_username,
      eventKey: "auction.sold",
      params: {
        auctionTitle: auction.title,
        amount: round2(price),
        winnerLabel: buyer.username,
        auctionId: auction.id,
      },
      deepLink: `${APP_URL}/#/item/${auction.id}`,
    });
  }
  const order = await getRecord("orders", orderId);
  if (order) io.emit("order:update", { order });
  const updated = await getRecord("auctions", auction.id);
  if (updated) {
    io.emit("auction:update", { auction: updated });
    io.emit("auction:ended", { auction: updated });
  }
  return orderId;
}

/** End a lot/auction unsold (no winner). */
async function endUnsold(auction: any): Promise<boolean> {
  const ok = await updateRecord("auctions", auction.id, { status: "ended", updated_at: nowIso() });
  if (!ok) {
    console.error(`[endUnsold] failed to end auction ${auction.id}`);
    return false;
  }
  await notify(auction.user, "info", "Auction ended unsold", auction.title, `#/item/${auction.id}`);
  const updated = await getRecord("auctions", auction.id);
  if (updated) {
    io.emit("auction:update", { auction: updated });
    io.emit("auction:ended", { auction: updated });
  }
  return true;
}

/** Advance a live room to its next unsold lot, or close the room. */
async function advanceRoom(session: any): Promise<boolean> {
  const lots = await getRecords(
    "auctions",
    `filter[live_session_id][$eq]=${session.id}&filter[status][$eq]=live&order=id&limit=100`,
  );
  const remaining = lots.filter((l: any) => l.id !== session.current_lot_id);
  const ok = remaining.length > 0
    ? await updateRecord("live_sessions", session.id, {
        current_lot_id: remaining[0].id,
        lot_index: Number(session.lot_index ?? 0) + 1,
        close_at: null,
        updated_at: nowIso(),
      })
    : await updateRecord("live_sessions", session.id, {
        status: "closed",
        current_lot_id: null,
        close_at: null,
        updated_at: nowIso(),
      });
  if (!ok) {
    console.error(`[advanceRoom] failed to update live_session ${session.id}`);
    return false;
  }
  const updated = await getRecord("live_sessions", session.id);
  if (updated) io.emit("room:update", { session: updated });
  return true;
}

// ── sweeps ───────────────────────────────────────────────────────────
async function sweepAuctions() {
  const due = await getRecords(
    "auctions",
    `filter[status][$eq]=live&filter[ends_at][$lte]=${encodeURIComponent(nowIso())}&limit=100`,
  );
  for (const staleAuction of due) {
    await bidService.withAuctionLock(Number(staleAuction.id), async () => {
      const auction = await getRecord("auctions", staleAuction.id);
      if (!auction || auction.status !== "live") return;
      const endsMs = Date.parse(auction.ends_at);
      if (Number.isFinite(endsMs) && endsMs > Date.now()) return;

      const bids = await getRecords(
        "bids",
        `filter[auction_id][$eq]=${auction.id}&order=-id&limit=50`,
      );
      const active = bids.find((b: any) => b.status === "active");
      const reserveMet =
        auction.reserve_price == null || (active ? active.amount : 0) >= auction.reserve_price;
      if (active && reserveMet) {
        const soldOk = await updateRecord("auctions", auction.id, { status: "sold", updated_at: nowIso() });
        if (!soldOk) {
          console.error(`[sweepAuctions] failed to mark auction ${auction.id} sold`);
          return;
        }
        const orderId = await createRecord("orders", {
          auction_id: auction.id,
          auction_title: auction.title,
          buyer_user: active.user,
          seller_user: auction.user,
          buyer_username: active.bidder_username,
          seller_username: auction.seller_username,
          final_price: active.amount,
          status: "pending_payment",
          pay_by: isoPlus(48 * 3600_000),
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        if (orderId == null) {
          console.error(`[sweepAuctions] failed to create order for auction ${auction.id}; rolling back status`);
          await updateRecord("auctions", auction.id, { status: "live", updated_at: nowIso() });
          return;
        }
        await notify(
          active.user,
          "won",
          "You won — payment due",
          `${auction.title} at US$${active.amount}. Complete payment within 48h (SLA).`,
          `#/orders/${orderId}`,
        );
        await notify(
          auction.user,
          "sold",
          "Your auction sold",
          `${auction.title} — US$${active.amount}.`,
          `#/orders/${orderId}`,
        );
        // TUCS: auction.won → winner, auction.sold → seller (channel fan-out).
        if (active.bidder_username) {
          commsEvent({
            userId: active.bidder_username,
            eventKey: "auction.won",
            params: { auctionTitle: auction.title, amount: active.amount, auctionId: auction.id },
            deepLink: `${APP_URL}/#/item/${auction.id}`,
          });
        }
        if (auction.seller_username) {
          commsEvent({
            userId: auction.seller_username,
            eventKey: "auction.sold",
            params: {
              auctionTitle: auction.title,
              amount: active.amount,
              winnerLabel: active.bidder_username,
              auctionId: auction.id,
            },
            deepLink: `${APP_URL}/#/item/${auction.id}`,
          });
        }
        const order = await getRecord("orders", orderId);
        if (order) io.emit("order:update", { order });
      } else {
        const endedOk = await updateRecord("auctions", auction.id, { status: "ended", updated_at: nowIso() });
        if (!endedOk) {
          console.error(`[sweepAuctions] failed to mark auction ${auction.id} ended`);
          return;
        }
        await notify(
          auction.user,
          "info",
          "Auction ended unsold",
          auction.title,
          `#/item/${auction.id}`,
        );
      }
      const updated = await getRecord("auctions", auction.id);
      if (updated) io.emit("auction:ended", { auction: updated });
    });
  }
  // payment SLA enforcement
  const overdue = await getRecords(
    "orders",
    `filter[status][$eq]=pending_payment&filter[pay_by][$lte]=${encodeURIComponent(nowIso())}&limit=100`,
  );
  for (const order of overdue) {
    const cancelOk = await updateRecord("orders", order.id, { status: "cancelled", updated_at: nowIso() });
    if (!cancelOk) {
      console.error(`[sweepAuctions] failed to cancel overdue order ${order.id}`);
      continue;
    }
    // Finance (12-b): reverse escrow on 48h-SLA auto-cancel — fire-and-forget.
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
    const lotId = session.current_lot_id;
    if (!lotId) continue;
    const auction = await getRecord("auctions", lotId);
    if (!auction || auction.status !== "live") {
      await advanceRoom(session);
      continue;
    }
    const bids = await getRecords(
      "bids",
      `filter[auction_id][$eq]=${lotId}&order=-id&limit=50`,
    );
    const active = bids.find((b: any) => b.status === "active");
    const reserveMet =
      auction.reserve_price == null || (active ? active.amount : 0) >= auction.reserve_price;
    if (active && reserveMet) {
      await sellAuctionTo(
        auction,
        { id: active.user, username: active.bidder_username },
        active.amount,
      );
      await audit(active.user, "room:hammer", "auctions", lotId, "web", {
        sessionId: session.id,
        amount: active.amount,
      });
    } else {
      await endUnsold(auction);
    }
    await advanceRoom(session);
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
    const expiredOk = await updateRecord("offers", offer.id, {
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso(),
    });
    if (!expiredOk) continue;
    await notify(
      offer.buyer_user,
      "info",
      "Offer expired",
      `Your offer of US$${offer.amount} expired without a response.`,
      `#/item/${offer.auction_id}`,
    );
    const updatedOffer = await getRecord("offers", offer.id);
    io.emit("offer:update", { auctionId: offer.auction_id, offer: updatedOffer ?? { ...offer, status: "expired" } });
  }
  const countered = await getRecords(
    "offers",
    `filter[status][$eq]=countered&filter[created_at][$lte]=${encodeURIComponent(
      new Date(Date.now() - 48 * 3600_000).toISOString(),
    )}&limit=100`,
  );
  for (const offer of countered) {
    const expiredOk = await updateRecord("offers", offer.id, {
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso(),
    });
    if (!expiredOk) continue;
    const updatedOffer = await getRecord("offers", offer.id);
    io.emit("offer:update", { auctionId: offer.auction_id, offer: updatedOffer ?? { ...offer, status: "expired" } });
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
    const ssOk = await updateRecord("saved_searches", ss.id, {
      last_seen_id: maxId,
      updated_at: nowIso(),
    });
    if (!ssOk) {
      console.error(`[sweepSavedSearches] failed to update last_seen_id for saved_search ${ss.id}`);
    }
  }
}

// ── server ───────────────────────────────────────────────────────────
function readJsonBody(req: IncomingMessage, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body) as unknown;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

async function authorizeAdminHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const internalHdr = req.headers["x-tgs-internal"];
  if (
    INTERNAL_SECRET.length > 0 &&
    typeof internalHdr === "string" &&
    timingSafeEqualStr(internalHdr, INTERNAL_SECRET)
  ) {
    return true;
  }
  const authHdr = req.headers.authorization;
  if (typeof authHdr === "string" && authHdr.toLowerCase().startsWith("bearer ")) {
    const token = authHdr.slice(7).trim();
    const resolved = await authResolver.resolveWithReason(token, { forceFresh: true });
    if (resolved.ok && resolved.identity.admin) return true;
    if (resolved.ok) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Admin authorization required." }));
      return false;
    }
  }
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Authentication required." }));
  return false;
}

const activeSocketsBySub = new Map<string, Set<Socket>>();
const activeSocketsByDigest = new Map<string, Set<Socket>>();

function trackSocketAuth(socket: Socket, sub: string, tokenDigest: string): void {
  let bySub = activeSocketsBySub.get(sub);
  if (!bySub) {
    bySub = new Set();
    activeSocketsBySub.set(sub, bySub);
  }
  bySub.add(socket);

  let byDig = activeSocketsByDigest.get(tokenDigest);
  if (!byDig) {
    byDig = new Set();
    activeSocketsByDigest.set(tokenDigest, byDig);
  }
  byDig.add(socket);

  socket.once("disconnect", () => {
    bySub?.delete(socket);
    if (bySub && bySub.size === 0) activeSocketsBySub.delete(sub);
    byDig?.delete(socket);
    if (byDig && byDig.size === 0) activeSocketsByDigest.delete(tokenDigest);
  });
}

function disconnectRevokedSockets(opts: { token?: string; sub?: string }): number {
  const targets = new Set<Socket>();
  if (opts.token) {
    const digest = sha256Hex(opts.token);
    for (const s of activeSocketsByDigest.get(digest) ?? []) targets.add(s);
  }
  if (opts.sub) {
    for (const s of activeSocketsBySub.get(opts.sub) ?? []) targets.add(s);
  }
  for (const s of targets) {
    try {
      s.emit("auth:revoked", { code: "AUTH_REVOKED", error: "Session revoked." });
      s.disconnect(true);
    } catch {
      /* ignore */
    }
  }
  return targets.size;
}

const httpServer = createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];
  if (req.method === "GET" && urlPath === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "tengasell-trade-engine", port: PORT, ok: true }));
    return;
  }
  // Admin: ensure the Next dev server (and its GIS child) is running.
  // Requires admin Bearer token or shared internal secret.
  if (req.method === "POST" && urlPath === "/admin/ensure-dev") {
    void authorizeAdminHttp(req, res).then((ok) => {
      if (ok) void handleEnsureDev(res);
    });
    return;
  }
  if (req.method === "GET" && urlPath === "/admin/status") {
    void authorizeAdminHttp(req, res).then((ok) => {
      if (!ok) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ next: nextDevRunning, checkedAt: new Date().toISOString() }));
    });
    return;
  }
  if (req.method === "POST" && urlPath === "/internal/auth/revoke") {
    void authorizeAdminHttp(req, res).then(async (ok) => {
      if (!ok) return;
      const body = await readJsonBody(req);
      if (!body) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON payload." }));
        return;
      }
      const token = typeof body.token === "string" ? body.token : undefined;
      const sub = typeof body.sub === "string" ? body.sub : undefined;
      const username = typeof body.username === "string" ? body.username : undefined;
      const cutoffSec = typeof body.cutoffSec === "number" ? body.cutoffSec : undefined;
      if (!token && !sub && !username) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Provide token, sub, or username." }));
        return;
      }
      if (token) authResolver.revokeToken(token);
      if (sub || username) authResolver.revokeSubject({ sub, username }, cutoffSec);
      const parsedSub = sub ?? (token ? parseStrictJwt(token)?.sub : undefined);
      const disconnected = disconnectRevokedSockets({ token, sub: parsedSub });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, disconnected }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── dev-server supervisor (anchor-spawned children persist) ──────────
import net from "node:net";
import fs from "node:fs";
import { spawn as cpSpawn } from "node:child_process";

const PROJECT_ROOT = process.env.TGS_PROJECT_ROOT
  ? path.resolve(process.env.TGS_PROJECT_ROOT)
  : path.resolve(ENGINE_DIR, "../..");

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
  const token = (socket.handshake.auth as { token?: unknown })?.token;
  let joinedRoom: string | null = null;
  const initialResolution: Promise<AuthResolution> =
    typeof token === "string" && token
      ? authResolver.resolveWithReason(token)
      : Promise.resolve({ ok: false, code: "AUTH_REQUIRED", error: "Sign in to continue." });

  void initialResolution.then((res) => {
    if (socket.disconnected) return;
    if (res.ok && res.identity.id) {
      joinedRoom = `user:${res.identity.id}`;
      void socket.join(joinedRoom);
      if (typeof token === "string") {
        trackSocketAuth(socket, res.claims.sub, sha256Hex(token));
      }
      socket.emit("hello", { ok: true, identity: { username: res.identity.username } });
    } else {
      socket.emit("hello", { ok: true, identity: null });
    }
  });

  // Never pin handshake identity (`me`) across socket lifetime: every mutating
  // RPC re-checks expiry, canonical _user/_session state, and revocations.
  const requireSocketAuth = async (
    ack: Ack | undefined,
    unauthenticatedMsg: string,
  ): Promise<Identity | null> => {
    await initialResolution;
    const res = await authResolver.resolveWithReason(token, { forceFresh: true });
    if (res.ok) {
      if (!res.identity.id) {
        ack?.(preCommitError("PROFILE_MISSING", "Account profile missing — reload and retry."));
        return null;
      }
      if (joinedRoom !== `user:${res.identity.id}`) {
        if (joinedRoom) void socket.leave(joinedRoom);
        joinedRoom = `user:${res.identity.id}`;
        void socket.join(joinedRoom);
      }
      return res.identity;
    }

    const message = res.code === "AUTH_REQUIRED" ? unauthenticatedMsg : res.error;
    ack?.(preCommitError(res.code, message));

    if (res.code === "AUTH_REVOKED" || res.code === "AUTH_EXPIRED") {
      if (joinedRoom) {
        void socket.leave(joinedRoom);
        joinedRoom = null;
      }
      try {
        socket.emit("auth:revoked", { code: res.code, error: res.error });
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          socket.disconnect(true);
        } catch {
          /* ignore */
        }
      }, 25);
    }
    return null;
  };

  socket.on("bid:place", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in to place bids.");
      if (!user) return;
      const result: BidOutcome = await bidService.handleBidPlace({
        user,
        auctionId: data?.auctionId,
        maxAmount: data?.maxAmount,
        clientRequestId: data?.clientRequestId,
      });
      ack?.(result);
    } catch (err) {
      // Unclassified exception before committed stage cannot be claimed pre_commit.
      console.error("[bid:place]", err);
      ack?.(
        uncertainBidOutcome(
          "COMMIT_UNCERTAIN",
          "Bid outcome could not be verified — refreshing auction state.",
        ),
      );
    }
  });

  // ── Gap-8: bid retraction (eBay-style, 60-minute window) ─────────────
  socket.on("bid:retract", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const bidId = Number(data?.bidId);
      const reason = String(data?.reason ?? "").trim();
      if (reason.length < 10)
        return ack?.({ ok: false, error: "Give a reason (at least 10 characters) for the retraction." });
      const initialBid = await getRecord("bids", bidId);
      if (!initialBid) return ack?.({ ok: false, error: "Bid not found." });
      await bidService.withAuctionLock(Number(initialBid.auction_id), async () => {
        const bid = await getRecord("bids", bidId);
        if (!bid) return ack?.({ ok: false, error: "Bid not found." });
        const auction = await getRecord("auctions", bid.auction_id);
        if (!auction || auction.status !== "live")
          return ack?.({ ok: false, error: "Bids can only be retracted while the auction is live." });
        if (bid.user !== user.id && !user.admin)
          return ack?.({ ok: false, error: "You can only retract your own bid." });
        if (bid.status !== "active")
          return ack?.({ ok: false, error: "Only the current leading bid can be retracted." });
        const ageMs = Date.now() - Date.parse(bid.created_at);
        if (!user.admin && ageMs > 60 * 60_000)
          return ack?.({
            ok: false,
            error: "The 60-minute retraction window has elapsed. Contact the seller or support.",
          });
        // restore the previous lead row (proxy ledger), then void the bid
        const rows = await getRecords(
          "bids",
          `filter[auction_id][$eq]=${bid.auction_id}&order=-id&limit=100`,
        );
        const prev = rows.find((b: any) => b.id < bid.id && b.status === "superseded");
        if (prev) {
          const prevOk = await updateRecord("bids", prev.id, { status: "active" });
          if (!prevOk) {
            return ack?.({ ok: false, error: "Could not restore previous leading bid — please retry." });
          }
        }
        const retractedOk = await updateRecord("bids", bidId, {
          status: "retracted",
          retracted_at: nowIso(),
          retraction_reason: reason.slice(0, 200),
        });
        if (!retractedOk) {
          if (prev) await updateRecord("bids", prev.id, { status: "superseded" });
          return ack?.({ ok: false, error: "Could not retract bid — please retry." });
        }
        const auctionOk = await updateRecord("auctions", auction.id, {
          current_price: prev ? prev.amount : auction.start_price,
          bid_count: Math.max(0, Number(auction.bid_count ?? 1) - 1),
          updated_at: nowIso(),
        });
        if (!auctionOk) {
          console.error(`[bid:retract] bid ${bidId} retracted but auction ${auction.id} update failed`);
          return ack?.({
            ok: false,
            error: "Could not update auction summary after retracting bid — please refresh.",
          });
        }
        await notify(
          auction.user,
          "info",
          "A bid was retracted",
          `${user.username} retracted their bid on ${auction.title}: “${reason.slice(0, 90)}”`,
          `#/item/${auction.id}`,
        );
        await audit(user.id, "bid:retract", "bids", bidId, "web", {
          auctionId: auction.id,
          reason,
          admin: user.admin,
        });
        const updated = await getRecord("auctions", auction.id);
        if (updated) io.emit("auction:update", { auction: updated });
        ack?.({ ok: true, auction: updated });
      });
    } catch (err) {
      console.error("[bid:retract]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: Best-Offer / haggle ──────────────────────────────────────
  socket.on("offer:submit", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in to make an offer.");
      if (!user) return;
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
        if (id != null) {
          const offer = await getRecord("offers", id);
          if (offer) io.emit("offer:update", { auctionId, offer });
        }
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
      if (id == null) {
        return ack?.({ ok: false, error: "Could not submit offer — please retry." });
      }
      const offer = await getRecord("offers", id);
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
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const offerId = Number(data?.offerId);
      const offer = await getRecord("offers", offerId);
      if (!offer) return ack?.({ ok: false, error: "Offer not found." });
      if (offer.buyer_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Not your offer." });
      if (offer.status !== "pending")
        return ack?.({ ok: false, error: "Only a pending offer can be withdrawn." });
      const withdrawnOk = await updateRecord("offers", offerId, {
        status: "withdrawn",
        responded_at: nowIso(),
        updated_at: nowIso(),
      });
      if (!withdrawnOk) {
        return ack?.({ ok: false, error: "Could not withdraw offer — please retry." });
      }
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
      if (updated) io.emit("offer:update", { auctionId: offer.auction_id, offer: updated });
      ack?.({ ok: true, offer: updated });
    } catch (err) {
      console.error("[offer:withdraw]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("offer:respond", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
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
        await bidService.withAuctionLock(Number(offer.auction_id), async () => {
          const freshOffer = await getRecord("offers", offerId);
          if (!freshOffer || freshOffer.status !== "pending")
            return ack?.({ ok: false, error: "This offer was already answered." });
          const freshAuction = await getRecord("auctions", freshOffer.auction_id);
          if (!freshAuction) return ack?.({ ok: false, error: "Item not found." });
          if (freshAuction.status !== "live")
            return ack?.({ ok: false, error: "This item is no longer live." });
          const orderId = await sellAuctionTo(
            freshAuction,
            { id: freshOffer.buyer_user, username: freshOffer.buyer_username },
            freshOffer.amount,
          );
          if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale — retry." });
          const acceptedOk = await updateRecord("offers", offerId, {
            status: "accepted",
            responded_at: nowIso(),
            updated_at: nowIso(),
          });
          if (!acceptedOk) {
            return ack?.({ ok: false, error: "Sale completed, but failed to update offer status — please refresh." });
          }
          await audit(user.id, "offer:accept", "offers", offerId, "web", {
            auctionId: freshAuction.id,
            amount: freshOffer.amount,
          });
          const updatedOffer = await getRecord("offers", offerId);
          if (updatedOffer) io.emit("offer:update", { auctionId: freshAuction.id, offer: updatedOffer });
          return ack?.({ ok: true, accepted: true, orderId, offer: updatedOffer });
        });
        return;
      }

      if (action === "decline") {
        const declinedOk = await updateRecord("offers", offerId, {
          status: "declined",
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        if (!declinedOk) {
          return ack?.({ ok: false, error: "Could not decline offer — please retry." });
        }
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
        if (updatedOffer) io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, declined: true, offer: updatedOffer });
      }

      if (action === "counter") {
        const amount = round2(Number(data?.amount));
        const message = String(data?.message ?? "").slice(0, 300);
        if (!Number.isFinite(amount) || amount < 1)
          return ack?.({ ok: false, error: "Enter a counter of US$1 or more." });
        if (auction.buy_now_price != null && amount >= Number(auction.buy_now_price))
          return ack?.({ ok: false, error: "Counter must stay below the buy-now price." });
        const counteredOk = await updateRecord("offers", offerId, {
          status: "countered",
          counter_amount: amount,
          counter_message: message || null,
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        if (!counteredOk) {
          return ack?.({ ok: false, error: "Could not send counter-offer — please retry." });
        }
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
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
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
        );
        if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale — retry." });
        const acceptedOk = await updateRecord("offers", offerId, {
          status: "accepted",
          responded_at: nowIso(),
          updated_at: nowIso(),
        });
        if (!acceptedOk) {
          return ack?.({ ok: false, error: "Sale completed, but failed to update offer status — please refresh." });
        }
        await audit(user.id, "offer:accept_counter", "offers", offerId, "web", {
          auctionId: auction.id,
          amount: price,
        });
        const updatedOffer = await getRecord("offers", offerId);
        if (updatedOffer) io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
        return ack?.({ ok: true, accepted: true, orderId, offer: updatedOffer });
      }

      const declinedOk = await updateRecord("offers", offerId, {
        status: "declined",
        responded_at: nowIso(),
        updated_at: nowIso(),
      });
      if (!declinedOk) {
        return ack?.({ ok: false, error: "Could not decline counter-offer — please retry." });
      }
      await notify(
        auction.user,
        "info",
        "Counter-offer declined",
        `${user.username} declined your US$${offer.counter_amount} counter on ${auction.title}.`,
        `#/item/${auction.id}`,
      );
      await audit(user.id, "offer:decline_counter", "offers", offerId, "web", {});
      const updatedOffer = await getRecord("offers", offerId);
      if (updatedOffer) io.emit("offer:update", { auctionId: auction.id, offer: updatedOffer });
      ack?.({ ok: true, declined: true, offer: updatedOffer });
    } catch (err) {
      console.error("[offer:counter-respond]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: featured listing (sell wizard, US$2 + VAT fee) ────────────
  socket.on("listing:feature", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
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
      const featOk = await updateRecord("auctions", auctionId, { featured: 1, updated_at: nowIso() });
      if (!featOk) {
        return ack?.({ ok: false, error: "Could not mark listing as featured — please retry." });
      }
      await notify(
        user.id,
        "info",
        "Listing featured",
        `${auction.title} now appears in the Featured rail. US$2 + VAT charged to your balance.`,
        `#/item/${auctionId}`,
      );
      await audit(user.id, "listing:feature", "auctions", auctionId, "web", { fee: 2 });
      const updated = await getRecord("auctions", auctionId);
      if (updated) io.emit("auction:update", { auction: updated });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[listing:feature]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  // ── Gap-8: live-room sessions (host + lots + hammer host controls) ──
  socket.on("room:create", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in to host a live room.");
      if (!user) return;
      const title = String(data?.title ?? "").trim().slice(0, 120);
      const scheduledAt = String(data?.scheduledAt ?? "").trim();
      if (title.length < 3)
        return ack?.({ ok: false, error: "Give the room a title (3+ characters)." });
      const when = scheduledAt && !Number.isNaN(Date.parse(scheduledAt))
        ? new Date(Date.parse(scheduledAt)).toISOString().replace(/\.\d+Z$/, "Z")
        : nowIso();
      const id = await createRecord("live_sessions", {
        host_user: user.id,
        host_username: user.username,
        title,
        scheduled_at: when,
        status: "scheduled",
        lot_index: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      if (id == null) {
        return ack?.({ ok: false, error: "Could not create live room — please retry." });
      }
      const session = await getRecord("live_sessions", id);
      await audit(user.id, "room:create", "live_sessions", id, "web", { title });
      if (session) io.emit("room:update", { session });
      ack?.({ ok: true, session });
    } catch (err) {
      console.error("[room:create]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("room:add-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const sessionId = Number(data?.sessionId);
      const auctionId = Number(data?.auctionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
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
      const addedOk = await updateRecord("auctions", auctionId, {
        live_session_id: sessionId,
        // lots live at the room's pace — park the timed end 30 days out so
        // the timed sweep never ends a lot mid-room.
        ends_at: isoPlus(30 * 24 * 3600_000),
        updated_at: nowIso(),
      });
      if (!addedOk) {
        return ack?.({ ok: false, error: "Could not add lot to live room — please retry." });
      }
      await audit(user.id, "room:add-lot", "auctions", auctionId, "web", { sessionId });
      const updated = await getRecord("auctions", auctionId);
      const updatedSession = await getRecord("live_sessions", sessionId);
      if (updated) io.emit("auction:update", { auction: updated });
      if (updatedSession) io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[room:add-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("room:remove-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const sessionId = Number(data?.sessionId);
      const auctionId = Number(data?.auctionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can remove lots." });
      const auction = await getRecord("auctions", auctionId);
      if (!auction || auction.live_session_id !== sessionId)
        return ack?.({ ok: false, error: "This listing is not a lot in this room." });
      if (session.current_lot_id === auctionId)
        return ack?.({ ok: false, error: "Close the current lot before removing it." });
      if (auction.status !== "live")
        return ack?.({ ok: false, error: "Sold/ended lots stay in the room history." });
      const removedOk = await updateRecord("auctions", auctionId, {
        live_session_id: null,
        ends_at: isoPlus(7 * 24 * 3600_000),
        updated_at: nowIso(),
      });
      if (!removedOk) {
        return ack?.({ ok: false, error: "Could not remove lot from live room — please retry." });
      }
      await audit(user.id, "room:remove-lot", "auctions", auctionId, "web", { sessionId });
      const updated = await getRecord("auctions", auctionId);
      if (updated) io.emit("auction:update", { auction: updated });
      ack?.({ ok: true, auction: updated });
    } catch (err) {
      console.error("[room:remove-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:open-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const sessionId = Number(data?.sessionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
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
        lot = lots.find((l: any) => l.id === Number(data.auctionId)) ?? null;
        if (!lot) return ack?.({ ok: false, error: "That lot is not available in this room." });
      } else {
        lot = lots.find((l: any) => l.id !== session.current_lot_id) ?? null;
      }
      if (!lot) return ack?.({ ok: false, error: "No more lots to open." });
      const openedOk = await updateRecord("live_sessions", sessionId, {
        status: "live",
        current_lot_id: lot.id,
        lot_index: Number(session.lot_index ?? 0) + 1,
        close_at: null,
        updated_at: nowIso(),
      });
      if (!openedOk) {
        return ack?.({ ok: false, error: "Could not open lot — please retry." });
      }
      await audit(user.id, "host:open-lot", "live_sessions", sessionId, "web", { lotId: lot.id });
      const updatedSession = await getRecord("live_sessions", sessionId);
      const watchers = await getRecords(
        "watchlist",
        `filter[auction_id][$eq]=${lot.id}&limit=100`,
      );
      for (const w of watchers) {
        if (w.user !== user.id) {
          await notify(
            w.user,
            "live",
            "Live room opening",
            `${lot.title} is on the block in “${session.title}”.`,
            `#/live/${sessionId}`,
          );
        }
      }
      io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, session: updatedSession, lot });
    } catch (err) {
      console.error("[host:open-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:close-lot", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const sessionId = Number(data?.sessionId);
      const sold = data?.sold === true;
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can close lots." });
      if (session.status !== "live" || !session.current_lot_id)
        return ack?.({ ok: false, error: "No lot is open in this room." });
      await bidService.withAuctionLock(Number(session.current_lot_id), async () => {
        const lot = await getRecord("auctions", session.current_lot_id);
        if (!lot) return ack?.({ ok: false, error: "Lot not found." });
        if (lot.status !== "live")
          return ack?.({ ok: false, error: "Lot is no longer live." });
        if (sold) {
          const bids = await getRecords(
            "bids",
            `filter[auction_id][$eq]=${lot.id}&order=-id&limit=50`,
          );
          const active = bids.find((b: any) => b.status === "active");
          if (!active)
            return ack?.({ ok: false, error: "No bids to sell to — pass the lot instead." });
          const orderId = await sellAuctionTo(
            lot,
            { id: active.user, username: active.bidder_username },
            active.amount,
          );
          if (orderId == null) return ack?.({ ok: false, error: "Could not complete the sale." });
          await audit(user.id, "room:hammer", "auctions", lot.id, "web", { sessionId, manual: true });
        } else {
          const unsoldOk = await endUnsold(lot);
          if (!unsoldOk) return ack?.({ ok: false, error: "Could not close lot — please retry." });
          await audit(user.id, "room:pass", "auctions", lot.id, "web", { sessionId });
        }
        const fresh = await getRecord("live_sessions", sessionId);
        const advancedOk = fresh ? await advanceRoom(fresh) : false;
        if (!advancedOk) {
          return ack?.({ ok: false, error: "Lot closed, but failed to advance live room — please refresh." });
        }
        const updatedSession = await getRecord("live_sessions", sessionId);
        ack?.({ ok: true, session: updatedSession });
      });
    } catch (err) {
      console.error("[host:close-lot]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("host:end-session", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const sessionId = Number(data?.sessionId);
      const session = await getRecord("live_sessions", sessionId);
      if (!session) return ack?.({ ok: false, error: "Live room not found." });
      if (session.host_user !== user.id && !user.admin)
        return ack?.({ ok: false, error: "Only the host can end the room." });
      if (session.status === "live" && session.current_lot_id)
        return ack?.({ ok: false, error: "Close the current lot first." });
      // unsold lots return to normal listings (7-day window) or end
      const lots = await getRecords(
        "auctions",
        `filter[live_session_id][$eq]=${sessionId}&filter[status][$eq]=live&limit=100`,
      );
      for (const lot of lots) {
        const lotOk = await updateRecord("auctions", lot.id, {
          live_session_id: null,
          ends_at: isoPlus(7 * 24 * 3600_000),
          updated_at: nowIso(),
        });
        if (!lotOk) {
          return ack?.({ ok: false, error: "Could not release live room lots — please retry." });
        }
        const updated = await getRecord("auctions", lot.id);
        if (updated) io.emit("auction:update", { auction: updated });
      }
      const closedOk = await updateRecord("live_sessions", sessionId, {
        status: "closed",
        current_lot_id: null,
        close_at: null,
        updated_at: nowIso(),
      });
      if (!closedOk) {
        return ack?.({ ok: false, error: "Could not close live room — please retry." });
      }
      await audit(user.id, "host:end-session", "live_sessions", sessionId, "web", {
        returnedLots: lots.length,
      });
      const updatedSession = await getRecord("live_sessions", sessionId);
      if (updatedSession) io.emit("room:update", { session: updatedSession });
      ack?.({ ok: true, session: updatedSession });
    } catch (err) {
      console.error("[host:end-session]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("buynow:purchase", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in to buy instantly.");
      if (!user) return;
      const auctionId = Number(data?.auctionId);
      if (!Number.isFinite(auctionId) || auctionId <= 0)
        return ack?.({ ok: false, error: "Auction not found." });
      await bidService.withAuctionLock(auctionId, async () => {
        const auction = await getRecord("auctions", auctionId);
        if (!auction) return ack?.({ ok: false, error: "Auction not found." });
        if (auction.status !== "live")
          return ack?.({ ok: false, error: "This auction is no longer live." });
        if (auction.buy_now_price == null)
          return ack?.({ ok: false, error: "This auction has no buy-now price." });
        const bids = await getRecords(
          "bids",
          `filter[auction_id][$eq]=${auctionId}&order=-id&limit=10`,
        );
        if (auction.bid_count > 0 || bids.some((b: any) => b.status === "active"))
          return ack?.({ ok: false, error: "Buy-now is no longer available after the first bid." });
        if (auction.user === user.id)
          return ack?.({ ok: false, error: "You cannot buy your own auction." });

        const soldOk = await updateRecord("auctions", auctionId, { status: "sold", updated_at: nowIso() });
        if (!soldOk) {
          return ack?.({ ok: false, error: "Could not reserve this listing — please retry." });
        }
        const orderId = await createRecord("orders", {
          auction_id: auctionId,
          auction_title: auction.title,
          buyer_user: user.id,
          seller_user: auction.user,
          buyer_username: user.username,
          seller_username: auction.seller_username,
          final_price: auction.buy_now_price,
          status: "pending_payment",
          // Delivery address the buyer selected at checkout (GIS displayName)
          address: typeof data?.address === "string" && data.address.trim()
            ? data.address.trim().slice(0, 200)
            : null,
          pay_by: isoPlus(48 * 3600_000),
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        if (orderId == null) {
          // Roll back the sold flag — the order row could not be created.
          await updateRecord("auctions", auctionId, { status: "live", updated_at: nowIso() });
          return ack?.({ ok: false, error: "Could not create the order — please retry." });
        }
        await notify(
          auction.user,
          "sold",
          "Your item sold (buy-now)",
          `${user.username} bought ${auction.title} for US$${auction.buy_now_price}.`,
          `#/orders/${orderId}`,
        );
        await notify(
          user.id,
          "order",
          "Reserved — complete payment",
          `${auction.title}: pay within 48h to confirm.`,
          `#/orders/${orderId}`,
        );
        // TUCS: buy-now is a won+sold pair — notify both parties cross-channel.
        commsEvent({
          userId: user.username,
          eventKey: "auction.won",
          params: { auctionTitle: auction.title, amount: auction.buy_now_price, auctionId },
          deepLink: `${APP_URL}/#/item/${auctionId}`,
        });
        if (auction.seller_username) {
          commsEvent({
            userId: auction.seller_username,
            eventKey: "auction.sold",
            params: {
              auctionTitle: auction.title,
              amount: auction.buy_now_price,
              winnerLabel: user.username,
              auctionId,
            },
            deepLink: `${APP_URL}/#/item/${auctionId}`,
          });
        }
        await audit(user.id, "buynow:purchase", "auctions", auctionId, "web", {
          price: auction.buy_now_price,
        });
        const order = await getRecord("orders", orderId ?? 0);
        const updatedAuction = await getRecord("auctions", auctionId);
        if (updatedAuction) io.emit("auction:update", { auction: updatedAuction });
        if (order) io.emit("order:update", { order });
        ack?.({ ok: true, orderId, order });
      });
    } catch (err) {
      console.error("[buynow:purchase]", err);
      ack?.({ ok: false, error: "Unexpected error — please retry." });
    }
  });

  socket.on("question:ask", async (data: any, ack?: Ack) => {
    try {
      const user = await requireSocketAuth(ack, "Sign in to ask questions.");
      if (!user) return;
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
      if (id == null) {
        return ack?.({ ok: false, error: "Could not post your question — please retry." });
      }
      const question = await getRecord("questions", id);
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
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const questionId = Number(data?.questionId);
      const body = String(data?.body ?? "").trim();
      const question = await getRecord("questions", questionId);
      if (!question) return ack?.({ ok: false, error: "Question not found." });
      const auction = await getRecord("auctions", question.auction_id);
      if (!auction || (auction.user !== user.id && !user.admin))
        return ack?.({ ok: false, error: "Only the seller can answer this question." });
      const answeredOk = await updateRecord("questions", questionId, { answer: body, answered_at: nowIso() });
      if (!answeredOk) {
        return ack?.({ ok: false, error: "Could not save your answer — please retry." });
      }
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
      const user = await requireSocketAuth(ack, "Sign in to send messages.");
      if (!user) return;
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
          if (threadId == null) {
            return ack?.({ ok: false, error: "Could not start conversation — please retry." });
          }
          thread = await getRecord("threads", threadId);
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
          if (threadId == null) {
            return ack?.({ ok: false, error: "Could not start conversation — please retry." });
          }
          thread = await getRecord("threads", threadId);
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
      if (messageId == null) {
        return ack?.({ ok: false, error: "Could not send message — please retry." });
      }
      const threadUpdatedOk = await updateRecord("threads", thread.id, { last_message_at: nowIso() });
      if (!threadUpdatedOk) {
        console.error(`[message:send] failed to update last_message_at for thread ${thread.id}`);
      }
      const message = await getRecord("messages", messageId);
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
      const user = await requireSocketAuth(ack, "Sign in to pay.");
      if (!user) return;
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
      const paidOk = await updateRecord("orders", orderId, {
        status: "paid",
        paid_at: nowIso(),
        updated_at: nowIso(),
      });
      if (!paidOk) {
        return ack?.({ ok: false, error: "Could not confirm order payment — please retry." });
      }
      const paymentId = await createRecord("payments", {
        order_id: orderId,
        user: user.id,
        method,
        amount: order.final_price,
        status: "settled",
        reference,
        created_at: nowIso(),
      });
      if (paymentId == null) {
        await updateRecord("orders", orderId, {
          status: "pending_payment",
          paid_at: null,
          updated_at: nowIso(),
        });
        return ack?.({ ok: false, error: "Could not record payment entry — please retry." });
      }
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
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
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
      const shippedOk = await updateRecord("orders", orderId, {
        status: "shipped",
        shipped_at: nowIso(),
        carrier,
        tracking,
        updated_at: nowIso(),
      });
      if (!shippedOk) {
        return ack?.({ ok: false, error: "Could not update shipment details — please retry." });
      }
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
      const user = await requireSocketAuth(ack, "Sign in first.");
      if (!user) return;
      const orderId = Number(data?.orderId);
      const order = await getRecord("orders", orderId);
      if (!order) return ack?.({ ok: false, error: "Order not found." });
      if (order.buyer_user !== user.id)
        return ack?.({ ok: false, error: "Only the buyer can confirm delivery." });
      if (order.status !== "shipped")
        return ack?.({ ok: false, error: "Order must be shipped first." });
      const deliveredOk = await updateRecord("orders", orderId, {
        status: "delivered",
        delivered_at: nowIso(),
        updated_at: nowIso(),
      });
      if (!deliveredOk) {
        return ack?.({ ok: false, error: "Could not confirm delivery — please retry." });
      }
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
      const user = await requireSocketAuth(ack, "Sign in to rate.");
      if (!user) return;
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
      if (ratingId == null) {
        return ack?.({ ok: false, error: "Could not save rating — please retry." });
      }
      const profiles = await getRecords(
        "profiles",
        `filter[user][$eq]=${encodeURIComponent(rateeUser)}&limit=1`,
      );
      const profile = profiles[0];
      if (profile) {
        const total = profile.rating_avg * profile.rating_count + score;
        const profOk = await updateRecord("profiles", profile.id, {
          rating_count: profile.rating_count + 1,
          rating_avg: Math.round((total / (profile.rating_count + 1)) * 100) / 100,
        });
        if (!profOk) {
          console.error(`[order:rate] failed to update profile ${profile.id} rating aggregate`);
        }
      }
      if (order.status === "delivered") {
        const compOk = await updateRecord("orders", orderId, {
          status: "completed",
          completed_at: nowIso(),
          updated_at: nowIso(),
        });
        if (!compOk) {
          return ack?.({
            ok: false,
            error: "Rating saved, but failed to update order status — please refresh.",
          });
        }
      }
      await notify(
        rateeUser,
        "rating",
        "You received a rating",
        `${user.username} rated you ${score}/5.`,
        `#/u/${rateeUsername}`,
      );
      await audit(user.id, "order:rate", "orders", orderId, "web", { score });
      const rating = await getRecord("ratings", ratingId);
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
      await ensureAdminToken(true);
      console.log(`[trade-engine] admin session established (${TRAILBASE})`);
      if (process.env.TRADE_SKIP_BOOT_REVIVE !== "1") {
        await reviveExpiredAuctions();
      }
    } catch (err) {
      console.error("[trade-engine] boot warning:", (err as Error).message);
    }
  })();
});

// sweeps
const sweepTimers = [
  setInterval(() => {
    void sweepAuctions().catch((err) => console.error("[sweep]", err));
  }, 10_000),
  // Gap-8 sweeps: live-room hammer (snappy 3s), offer expiry, search alerts
  setInterval(() => {
    void sweepLiveRooms().catch((err) => console.error("[sweep:rooms]", err));
  }, 3_000),
  setInterval(() => {
    void sweepOfferExpiry().catch((err) => console.error("[sweep:offers]", err));
  }, 30_000),
  setInterval(() => {
    void sweepSavedSearches().catch((err) => console.error("[sweep:searches]", err));
  }, 60_000),
  // refresh admin token periodically
  setInterval(() => {
    adminToken = null;
    adminTokenExpMs = 0;
  }, 30 * 60_000),
];

function shutdown(signal: string): void {
  console.log(`[trade-engine] shutting down (${signal})`);
  for (const t of sweepTimers) clearInterval(t);
  canonicalStore?.close();
  revocationStore?.close?.();
  try {
    io.close();
  } catch {
    /* ignore */
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => console.error("[unhandled]", err));
