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

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openSqliteDb, type SqliteDb } from "./sqlite";
import { tbCreate, tbGet, tbList, tbPatch, nowIso } from "./trailbase-admin";
import { isMockMode } from "./paynow";

const getTrailBaseUrl = () => process.env.TRAILBASE_URL ?? "http://localhost:3001";

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

// ── buyer authentication (mirrors the trade engine's strict verifier) ──

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface VerifiedSession {
  sub: string;
  username: string;
  admin: boolean;
  mfa: boolean;
  iat: number;
  token: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function decodeStrictJwt(token: string): {
  alg?: string;
  sub?: string;
  username?: string;
  admin?: boolean;
  mfa?: boolean;
  exp?: number;
  iat?: number;
  nbf?: number;
} | null {
  try {
    if (!token || token.length > 4096 || token.trim() !== token) return null;
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      !parts[0] ||
      !parts[1] ||
      !parts[2] ||
      !B64URL_RE.test(parts[0]) ||
      !B64URL_RE.test(parts[1]) ||
      !B64URL_RE.test(parts[2])
    ) {
      return null;
    }
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof header?.alg !== "string" || !header.alg || header.alg.toLowerCase() === "none") {
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (!payload || typeof payload !== "object") return null;
    if (payload.iat != null && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat))) {
      return null;
    }
    return {
      alg: header.alg,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      username: typeof payload.username === "string" ? payload.username : undefined,
      admin: payload.admin === true,
      mfa: payload.mfa === true,
      exp: typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined,
      iat: typeof payload.iat === "number" && Number.isFinite(payload.iat) ? payload.iat : undefined,
      nbf: typeof payload.nbf === "number" && Number.isFinite(payload.nbf) ? payload.nbf : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveTrailBaseDataDirForBff(): string | null {
  const candidates = [
    process.env.TRAILBASE_DATA_DIR,
    process.env.TGS_DATA_DIR ? path.join(process.env.TGS_DATA_DIR, "traildepot", "data") : undefined,
    process.env.TGS_PROJECT_ROOT
      ? path.join(process.env.TGS_PROJECT_ROOT, "mini-services", "trailbase-db", "traildepot", "data")
      : undefined,
    path.join(process.cwd(), "mini-services", "trailbase-db", "traildepot", "data"),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, "main.db")) || fs.existsSync(path.join(dir, "session.db"))) {
      return dir;
    }
  }
  return null;
}

function checkRevocationsDb(
  revPath: string,
  tokens: string[],
  sub: string,
  username: string,
  claimsIat: number,
  nowMs: number,
): boolean {
  if (!fs.existsSync(revPath)) return false;
  let db: SqliteDb | null = null;
  try {
    db = openSqliteDb(revPath, { readOnly: true });
    db.exec("PRAGMA busy_timeout=2000");
    for (const tok of tokens) {
      const digest = sha256Hex(tok);
      const row = db
        .prepare("SELECT 1 AS ok FROM revoked_tokens WHERE digest = ? AND exp_ms > ? LIMIT 1")
        .get(digest, nowMs) as { ok?: number } | undefined;
      if (row) return true;
    }
    for (const key of [`sub:${sub}`, `user:${username.toLowerCase()}`]) {
      const row = db
        .prepare("SELECT cutoff_sec FROM revoked_subjects WHERE subject_key = ? LIMIT 1")
        .get(key) as { cutoff_sec?: number } | undefined;
      if (row && typeof row.cutoff_sec === "number" && claimsIat <= row.cutoff_sec) {
        return true;
      }
    }
    return false;
  } catch {
    // Fail closed if revocation store exists but cannot be read.
    return true;
  } finally {
    db?.close();
  }
}

function checkCanonicalSqliteSession(
  verified: { sub: string; username: string; admin: boolean; iat: number },
  rawToken: string,
  verifiedToken: string,
  nowMs: number,
): { ok: true; admin: boolean } | { ok: false } {
  const dataDir = resolveTrailBaseDataDirForBff();
  const requireDb =
    Boolean(process.env.TRAILBASE_DATA_DIR) || process.env.TRAILBASE_REQUIRE_SESSION_DB === "1";

  const revPath =
    process.env.TGS_REVOCATIONS_DB ||
    (dataDir ? path.join(dataDir, "tgs_revocations.db") : null);
  if (revPath && checkRevocationsDb(revPath, [rawToken, verifiedToken], verified.sub, verified.username, verified.iat, nowMs)) {
    return { ok: false };
  }

  if (!dataDir) {
    if (requireDb) return { ok: false };
    return { ok: true, admin: verified.admin };
  }

  const mainPath = path.join(dataDir, "main.db");
  const sessionPath = path.join(dataDir, "session.db");
  if (!fs.existsSync(mainPath) || !fs.existsSync(sessionPath)) {
    return { ok: false };
  }

  let uidBytes: Buffer;
  try {
    uidBytes = Buffer.from(verified.sub, "base64");
    if (uidBytes.length !== 16) return { ok: false };
  } catch {
    return { ok: false };
  }
  const uidParam = new Uint8Array(uidBytes);

  let mainDb: SqliteDb | null = null;
  let sessionDb: SqliteDb | null = null;
  try {
    mainDb = openSqliteDb(mainPath, { readOnly: true });
    mainDb.exec("PRAGMA busy_timeout=2000");
    const userRow = mainDb
      .prepare("SELECT username, admin FROM _user WHERE id = ? LIMIT 1")
      .get(uidParam) as { username?: string | null; admin?: number | boolean } | undefined;
    if (!userRow || userRow.username !== verified.username) {
      return { ok: false };
    }

    sessionDb = openSqliteDb(sessionPath, { readOnly: true });
    sessionDb.exec("PRAGMA busy_timeout=2000");
    const nowSec = Math.floor(nowMs / 1000);
    const iatUpper = Math.floor(verified.iat);
    const sess = sessionDb
      .prepare("SELECT 1 AS ok FROM _session WHERE user = ? AND expires > ? AND created <= ? LIMIT 1")
      .get(uidParam, nowSec, iatUpper) as { ok?: number } | undefined;
    if (!sess) {
      return { ok: false };
    }

    return { ok: true, admin: Boolean(userRow.admin) };
  } catch {
    return { ok: false };
  } finally {
    try {
      mainDb?.close();
    } catch {
      /* ignore */
    }
    try {
      sessionDb?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Full verified buyer/admin session resolution against TrailBase `/status`,
 * canonical SQLite `_user`/`_session`, and durable `tgs_revocations.db`.
 */
export async function resolveVerifiedSession(
  authHeader: string | null,
): Promise<VerifiedSession | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const presented = decodeStrictJwt(token);
  const nowMs = Date.now();
  if (
    !presented?.sub ||
    !presented.username ||
    !presented.exp ||
    presented.exp * 1000 <= nowMs ||
    typeof presented.iat !== "number"
  ) {
    return null;
  }
  if (presented.nbf != null && presented.nbf * 1000 > nowMs) return null;
  try {
    const res = await fetch(`${getTrailBaseUrl()}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { auth_token?: unknown };
    if (typeof data.auth_token !== "string" || !data.auth_token) return null;
    const verified = decodeStrictJwt(data.auth_token);
    const checkNowMs = Date.now();
    if (
      !verified?.sub ||
      !verified.username ||
      !verified.exp ||
      verified.exp * 1000 <= checkNowMs ||
      typeof verified.iat !== "number" ||
      verified.sub !== presented.sub ||
      verified.username !== presented.username
    ) {
      return null;
    }
    if (verified.nbf != null && verified.nbf * 1000 > checkNowMs) return null;

    const canonical = checkCanonicalSqliteSession(
      {
        sub: verified.sub,
        username: verified.username,
        admin: Boolean(verified.admin),
        iat: verified.iat,
      },
      token,
      data.auth_token,
      checkNowMs,
    );
    if (!canonical.ok) return null;

    return {
      sub: verified.sub,
      username: verified.username,
      admin: canonical.admin,
      mfa: verified.mfa === true,
      iat: verified.iat,
      token: data.auth_token,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the caller from an "Authorization: Bearer <trailbase_token>"
 * header: strictly verifies token structure, expiry, TrailBase `/status`,
 * canonical SQLite `_user`/`_session`, and durable revocations.
 */
export async function resolveUserFromToken(
  authHeader: string | null,
): Promise<{ username: string; admin: boolean; token: string } | null> {
  const session = await resolveVerifiedSession(authHeader);
  if (!session) return null;
  return { username: session.username, admin: session.admin, token: session.token };
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
    const res = await fetch(`${getTrailBaseUrl()}/api/records/v1/orders/${orderId}`, {
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
