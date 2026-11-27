// Tengasell × Paynow order glue — server-side only.
//
// Shared helpers for the /api/paynow/* routes: user authentication against
// the TrailBase auth API (mirrors the trade engine's resolveIdentity),
// session-row loading from the paynow_sessions table, and the order
// settlement that MIRRORS the trade engine's `order:pay` handler exactly:
//   · orders row → status "paid", paid_at, updated_at
//   · payments row insert { order_id, user, method, amount, status:
//     "settled", reference }
//   · notifications insert for the seller ("Payment received … dispatch
//     within 3 days (SLA)")
//   · audit_events insert (action "order:pay", source "web")
//   · finance "order.paid" event (fire-and-forget — same shape the trade
//     engine sends; the finance 60s sweep backfills if it is missed)

import { tbCreate, tbGet, tbList, tbPatch, nowIso } from "./trailbase-admin";
import { isMockMode } from "./paynow";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
const FINANCE_URL = process.env.FINANCE_URL ?? "http://localhost:3006";

// ── finance bridge (parity with the trade engine's order:pay) ────────

/**
 * Fire-and-forget lifecycle event to the finance-service (:3006) — 2s
 * timeout, errors swallowed: settlement NEVER waits on finance (the 60s
 * finance sweep backfills escrow for paid orders regardless).
 */
function financeEvent(type: string, payload: Record<string, unknown>): void {
  void fetch(`${FINANCE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
}

// ── row shapes (mirror the SQLite schema) ─────────────────────────────

export interface OrderRow {
  id: number;
  auction_id: number;
  auction_title: string;
  buyer_user: string;
  seller_user: string;
  buyer_username: string;
  seller_username: string;
  final_price: number;
  status: string;
  pay_by: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaynowSessionRow {
  id: number;
  order_id: number;
  reference: string;
  amount: number;
  method: string;
  phone: string | null;
  status: string; // pending | paid | cancelled | failed | disputed
  poll_url: string | null;
  redirect_url: string | null;
  paynow_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** paynow_settlements row — the durable settlement journal (R3). */
export interface SettlementRow {
  id: number;
  reference: string; // UNIQUE — the atomic claim key
  order_id: number;
  status: string; // pending (in flight / crashed) | done (fully settled)
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function toSettlementRow(
  r: Record<string, unknown> | null,
): SettlementRow | null {
  if (!r) return null;
  return {
    id: Number(r.id ?? 0),
    reference: String(r.reference ?? ""),
    order_id: Number(r.order_id ?? 0),
    status: String(r.status ?? "pending"),
    attempts: Number(r.attempts ?? 1),
    last_error: r.last_error != null ? String(r.last_error) : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export function toOrderRow(r: Record<string, unknown> | null): OrderRow | null {
  if (!r) return null;
  return {
    id: num(r.id),
    auction_id: num(r.auction_id),
    auction_title: String(r.auction_title ?? ""),
    buyer_user: String(r.buyer_user ?? ""),
    seller_user: String(r.seller_user ?? ""),
    buyer_username: String(r.buyer_username ?? ""),
    seller_username: String(r.seller_username ?? ""),
    final_price: num(r.final_price),
    status: String(r.status ?? ""),
    pay_by: r.pay_by != null ? String(r.pay_by) : null,
    paid_at: r.paid_at != null ? String(r.paid_at) : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

export function toSessionRow(r: Record<string, unknown> | null): PaynowSessionRow | null {
  if (!r) return null;
  return {
    id: num(r.id),
    order_id: num(r.order_id),
    reference: String(r.reference ?? ""),
    amount: num(r.amount),
    method: String(r.method ?? ""),
    phone: r.phone != null ? String(r.phone) : null,
    status: String(r.status ?? "pending"),
    poll_url: r.poll_url != null ? String(r.poll_url) : null,
    redirect_url: r.redirect_url != null ? String(r.redirect_url) : null,
    paynow_hash: r.paynow_hash != null ? String(r.paynow_hash) : null,
    error: r.error != null ? String(r.error) : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

// ── buyer authentication (mirrors the trade engine's resolveIdentity) ──

function decodeJwt(token: string): { username?: string; admin?: boolean } {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve the caller from an "Authorization: Bearer <trailbase_token>"
 * header: verifies the token with /api/auth/v1/status and decodes the
 * username from the (active) JWT payload. Returns the token too so
 * callers can read records WITH the user's own credentials. Null when
 * invalid.
 */
export async function resolveUserFromToken(
  authHeader: string | null,
): Promise<{ username: string; admin: boolean; token: string } | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { auth_token?: string };
    const active = typeof data.auth_token === "string" ? data.auth_token : token;
    const payload = decodeJwt(active);
    if (!payload.username) return null;
    return { username: payload.username, admin: !!payload.admin, token };
  } catch {
    return null;
  }
}

/**
 * GET /api/records/v1/orders/{id} WITH the user's token — the ACL lets the
 * buyer and seller read the row, so a hit proves the caller is a party to
 * the order (used by the initiate route instead of an admin fetch).
 */
export async function fetchOrderWithUserToken(
  token: string,
  orderId: number,
): Promise<OrderRow | null> {
  try {
    const res = await fetch(`${TRAILBASE}/api/records/v1/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return toOrderRow((await res.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

// ── sessions ──────────────────────────────────────────────────────────

export async function loadSessionByReference(
  reference: string,
): Promise<PaynowSessionRow | null> {
  const rows = await tbList("paynow_sessions", {
    [`filter[reference][$eq]`]: reference,
    limit: 1,
  });
  return toSessionRow(rows[0] ?? null);
}

/**
 * Newest session row for an order — the return-page poll loop (after the
 * buyer comes back from paynow.co.zw) and the reconciliation sweep key
 * off the order, not the merchant reference (the buyer's browser only
 * knows the orderId from the return URL).
 */
export async function loadLatestSessionForOrder(
  orderId: number,
): Promise<PaynowSessionRow | null> {
  const rows = await tbList("paynow_sessions", {
    "filter[order_id][$eq]": orderId,
    order: "-id",
    limit: 1,
  });
  return toSessionRow(rows[0] ?? null);
}

export async function patchSession(
  session: PaynowSessionRow,
  patch: Partial<PaynowSessionRow>,
): Promise<PaynowSessionRow> {
  await tbPatch("paynow_sessions", session.id, patch as Record<string, unknown>);
  return { ...session, ...patch, updated_at: nowIso() };
}

// ── settlement journal (durable idempotency — R3) ─────────────────────
//
// The journal row is the atomic claim + completion record for settling a
// paid session. `reference` is UNIQUE in SQLite: the first insert wins and
// every later caller (webhook, return-page poll, reconcile sweep — in any
// process) can see whether settlement is in flight (pending), complete
// (done) or abandoned (stale pending → recoverable). An in-process Set is
// kept only as a fast same-process guard — correctness never depends on it.

/** Journal claims older than this are considered abandoned (claimant
 *  crashed mid-settlement) and may be taken over by any caller. */
const CLAIM_FRESH_MS = 120_000;

/** In-process settle guard — fast path only (see journal above). */
const settling = new Set<number>();

export async function getSettlementByReference(
  reference: string,
): Promise<SettlementRow | null> {
  const rows = await tbList("paynow_settlements", {
    "filter[reference][$eq]": reference,
    limit: 1,
  });
  return toSettlementRow(rows[0] ?? null);
}

function isClaimFresh(row: SettlementRow): boolean {
  const t = Date.parse(row.updated_at);
  return Number.isFinite(t) && Date.now() - t < CLAIM_FRESH_MS;
}

async function markSettlementDone(reference: string): Promise<void> {
  const row = await getSettlementByReference(reference);
  if (row && row.status !== "done") {
    await tbPatch("paynow_settlements", row.id, {
      status: "done",
      updated_at: nowIso(),
    });
  }
}

/**
 * Settle a paid session — MIRRORS the trade engine's `order:pay` handler.
 * The payments row records the gateway path (method "paynow-{method}")
 * with the TS-ORDR reference.
 *
 * Idempotency is DURABLE: the paynow_settlements journal row (unique on
 * reference) is claimed before any write and marked done after the last
 * one, so repeat deliveries, concurrent callers and process crashes can
 * neither double-write (payments/notifications/audit) nor strand a paid
 * session half-settled — the reconcile sweep recovers stale claims.
 */
export async function settlePaidOrder(
  session: PaynowSessionRow,
): Promise<OrderRow | null> {
  const order = toOrderRow(await tbGet("orders", session.order_id));
  if (!order) return null;

  // Authoritative-amount invariant: the session must match the order it
  // pays. A mismatch means the row was tampered with or written by a bug —
  // never settle it (fail closed, disputed for the support path).
  if (Math.round(session.amount * 100) !== Math.round(order.final_price * 100)) {
    const already = session.status === "disputed" &&
      String(session.error ?? "").includes("order-amount-mismatch");
    if (!already) {
      await patchSession(session, {
        status: "disputed",
        error: `order-amount-mismatch: session ${session.amount} vs order ${order.final_price}`,
      });
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:settle-rejected",
        entity: "paynow_sessions",
        entity_id: session.id,
        source: "settle",
        payload: JSON.stringify({
          reference: session.reference,
          reason: "order-amount-mismatch",
          sessionAmount: session.amount,
          orderAmount: order.final_price,
        }),
        created_at: nowIso(),
      });
    }
    return order;
  }

  // 1. fully settled already → cheap no-op for every later caller
  const journal = await getSettlementByReference(session.reference);
  if (journal?.status === "done") return order;

  // 2. same-process fast guard (concurrent webhook/poll/sweep here)
  if (settling.has(session.order_id)) return order;

  // 3. another process is actively settling (fresh claim) → let it finish
  if (journal && journal.status === "pending" && isClaimFresh(journal)) {
    return order;
  }

  settling.add(session.order_id);
  try {
    let claim = journal;
    if (!claim) {
      // 4. atomic claim: UNIQUE(reference) — exactly one process wins
      const now = nowIso();
      const id = await tbCreate("paynow_settlements", {
        reference: session.reference,
        order_id: session.order_id,
        status: "pending",
        attempts: 1,
        created_at: now,
        updated_at: now,
      });
      if (id == null) {
        // Lost the race (or the store is unreachable) — never settle
        // without holding a claim: fail closed and let the webhook/poll/
        // sweep retry.
        const raced = await getSettlementByReference(session.reference);
        if (raced?.status === "done") return order;
        if (raced && isClaimFresh(raced)) return order;
        if (!raced) return order; // store failure — no claim, no settle
        claim = raced; // stale claim — take over below
      }
    }
    if (claim && claim.status === "pending") {
      // take-over / retry marker (also refreshes claim freshness)
      await tbPatch("paynow_settlements", claim.id, {
        attempts: claim.attempts + 1,
        updated_at: nowIso(),
      });
    }

    try {
      const settled = await settlePaidOrderInner(session, order);
      await markSettlementDone(session.reference);
      return settled;
    } catch (err) {
      // Leave the claim pending: it goes stale after CLAIM_FRESH_MS and
      // the reconcile sweep (or a repeat webhook/poll) recovers it.
      const row = await getSettlementByReference(session.reference);
      if (row && row.status === "pending") {
        await tbPatch("paynow_settlements", row.id, {
          last_error: String((err as Error)?.message ?? err).slice(0, 200),
          updated_at: nowIso(),
        });
      }
      console.error("[paynow/settle]", err);
      return order;
    }
  } finally {
    settling.delete(session.order_id);
  }
}

async function settlePaidOrderInner(
  session: PaynowSessionRow,
  order: OrderRow,
): Promise<OrderRow | null> {
  const now = nowIso();
  if (order.status === "pending_payment") {
    const patched = await tbPatch("orders", order.id, {
      status: "paid",
      paid_at: now,
      updated_at: now,
    });
    if (!patched) throw new Error("orders patch failed");
  }

  // payments row (skip when this reference was already recorded)
  const existing = await tbList("payments", {
    [`filter[order_id][$eq]`]: order.id,
    limit: 50,
  });
  const duplicate = existing.some((p) => String(p.reference) === session.reference);
  if (!duplicate) {
    const payId = await tbCreate("payments", {
      order_id: order.id,
      user: order.buyer_user,
      method: `paynow-${session.method}`,
      amount: order.final_price,
      status: "settled",
      reference: session.reference,
      created_at: now,
    });
    if (payId == null) throw new Error("payments insert failed");
  }

  // seller notification (dedup by link+title — crash/retry safe)
  const priorNotes = await tbList("notifications", {
    "filter[link][$eq]": `#/orders/${order.id}`,
    "filter[title][$eq]": "Payment received",
    limit: 1,
  });
  if (priorNotes.length === 0) {
    const noteId = await tbCreate("notifications", {
      user: order.seller_user,
      type: "order",
      title: "Payment received",
      body: `${order.auction_title} — US$${order.final_price}. Dispatch within 3 days (SLA).`,
      link: `#/orders/${order.id}`,
      read: 0,
      created_at: now,
    });
    if (noteId == null) throw new Error("notification insert failed");
  }

  // audit trail (dedup by action+entity — one order:pay row per order)
  const priorAudits = await tbList("audit_events", {
    "filter[action][$eq]": "order:pay",
    "filter[entity][$eq]": "orders",
    "filter[entity_id][$eq]": order.id,
    limit: 1,
  });
  if (priorAudits.length === 0) {
    const auditId = await tbCreate("audit_events", {
      user: order.buyer_user,
      action: "order:pay",
      entity: "orders",
      entity_id: order.id,
      source: "web",
      payload: JSON.stringify({
        method: session.method,
        reference: session.reference,
        gateway: "paynow",
      }),
      created_at: now,
    });
    if (auditId == null) throw new Error("audit insert failed");
  }

  // Finance (12-b parity with the engine's order:pay): fund escrow for this
  // payment — item price + the auction's shipping fee. Fire-and-forget; the
  // finance 60s sweep backfills if this call is missed.
  const auction = await tbGet("auctions", order.auction_id).catch(() => null);
  financeEvent("order.paid", {
    orderId: order.id,
    buyer: order.buyer_username,
    seller: order.seller_username,
    itemPrice: Number(order.final_price ?? 0),
    shipping: Number((auction as { shipping_fee?: number } | null)?.shipping_fee ?? 0),
    method: `paynow-${session.method}`,
    reference: session.reference,
  });

  return toOrderRow(await tbGet("orders", order.id));
}

// ── reference + redirect helpers ──────────────────────────────────────

/** Merchant reference, e.g. TS-ORDR13-1760879823001 (order id + epoch ms). */
export function makeReference(orderId: number): string {
  return `TS-ORDR${orderId}-${Date.now()}`;
}

export function isValidReference(reference: string): boolean {
  return /^TS-ORDR\d{1,10}-\d{10,15}$/.test(reference);
}

/**
 * Sandbox redirect for mock mode — the hosted-checkout simulation page,
 * with display hints as query params (the page re-verifies everything via
 * /api/paynow/poll, so these cannot spoof the payment state). The buyer's
 * raw phone number is deliberately NOT carried in the URL — the page gets
 * a masked hint from the authenticated poll response instead.
 */
export function sandboxRedirectUrl(p: {
  reference: string;
  amount: number;
  method: string;
  title: string;
  orderId: number;
}): string {
  const params = new URLSearchParams({
    amount: p.amount.toFixed(2),
    method: p.method,
    order: String(p.orderId),
    title: p.title,
  });
  return `#/pay/${encodeURIComponent(p.reference)}?${params.toString()}`;
}

/** Masked display hint for a stored phone — never the raw number. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return last4 ? `••• ••• ${last4}` : null;
}

/**
 * Return/result URLs for the real gateway. The buyer's return URL is
 * ALWAYS order-specific (`…/#/orders/{orderId}`) — PAYNOW_RETURN_URL, when
 * set, is the app's base URL (any trailing `/` or `#/…` fragment is
 * normalized away and the order path is appended).
 */
export function paynowUrls(origin: string, orderId: number): { returnUrl: string; resultUrl: string } {
  const base = process.env.PAYNOW_RETURN_URL?.trim();
  const normalized = base
    ? base.replace(/\/+$/, "").replace(/\/#\/(orders\/?)?$/, "")
    : origin.replace(/\/+$/, "");
  const returnUrl = `${normalized}/#/orders/${orderId}`;
  const resultUrl = process.env.PAYNOW_RESULT_URL || `${origin}/api/paynow/callback`;
  return { returnUrl, resultUrl };
}

export { isMockMode };
