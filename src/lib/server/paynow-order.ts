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

import { tbCreate, tbGet, tbList, tbPatch, nowIso } from "./trailbase-admin";
import { isMockMode } from "./paynow";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

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
  status: string; // pending | paid | cancelled | failed
  poll_url: string | null;
  redirect_url: string | null;
  paynow_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
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

export async function patchSession(
  session: PaynowSessionRow,
  patch: Partial<PaynowSessionRow>,
): Promise<PaynowSessionRow> {
  await tbPatch("paynow_sessions", session.id, patch as Record<string, unknown>);
  return { ...session, ...patch, updated_at: nowIso() };
}

/**
 * Settle a paid session — MIRRORS the trade engine's `order:pay` handler.
 * The payments row records the gateway path (method "paynow-{method}")
 * with the TS-ORDR reference.
 * Idempotent: when the order already left pending_payment it is returned
 * unchanged (no duplicate payments/notifications/audit rows).
 */
export async function settlePaidOrder(
  session: PaynowSessionRow,
): Promise<OrderRow | null> {
  const order = toOrderRow(await tbGet("orders", session.order_id));
  if (!order) return null;
  if (order.status !== "pending_payment") return order;

  const now = nowIso();
  await tbPatch("orders", order.id, {
    status: "paid",
    paid_at: now,
    updated_at: now,
  });

  // payments row (skip when this reference was already recorded)
  const existing = await tbList("payments", {
    [`filter[order_id][$eq]`]: order.id,
    limit: 50,
  });
  const duplicate = existing.some((p) => String(p.reference) === session.reference);
  if (!duplicate) {
    await tbCreate("payments", {
      order_id: order.id,
      user: order.buyer_user,
      method: `paynow-${session.method}`,
      amount: order.final_price,
      status: "settled",
      reference: session.reference,
      created_at: now,
    });
  }

  // seller notification (identical wording to the engine's order:pay)
  await tbCreate("notifications", {
    user: order.seller_user,
    type: "order",
    title: "Payment received",
    body: `${order.auction_title} — US$${order.final_price}. Dispatch within 3 days (SLA).`,
    link: `#/orders/${order.id}`,
    read: 0,
    created_at: now,
  });

  // audit trail (same action/entity the engine records)
  await tbCreate("audit_events", {
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
 * /api/paynow/poll, so these cannot spoof the payment state).
 */
export function sandboxRedirectUrl(p: {
  reference: string;
  amount: number;
  method: string;
  phone?: string | null;
  title: string;
  orderId: number;
}): string {
  const params = new URLSearchParams({
    amount: p.amount.toFixed(2),
    method: p.method,
    order: String(p.orderId),
    title: p.title,
  });
  if (p.phone) params.set("phone", p.phone);
  return `#/pay/${encodeURIComponent(p.reference)}?${params.toString()}`;
}

/** Return/result URLs for the real gateway (env or derived from origin). */
export function paynowUrls(origin: string, orderId: number): { returnUrl: string; resultUrl: string } {
  const returnUrl =
    process.env.PAYNOW_RETURN_URL || `${origin}/#/orders/${orderId}`;
  const resultUrl = process.env.PAYNOW_RESULT_URL || `${origin}/api/paynow/callback`;
  return { returnUrl, resultUrl };
}

export { isMockMode };
