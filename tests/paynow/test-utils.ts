// tests/paynow/test-utils.ts — in-test emulators for the TrailBase records
// API and the Paynow gateway, installed over global.fetch.
//
// The server modules under test (routes, paynow.ts, paynow-order.ts,
// paynow-reconcile.ts) talk HTTP to TrailBase (:3001 in real deployments)
// and to https://www.paynow.co.zw. This harness intercepts every fetch and
// serves both sides from an in-memory database with the exact response
// shapes the real services use (records list/create/patch, auth status,
// url-encoded gateway polls) — including UNIQUE(reference) behaviour on
// paynow_sessions / paynow_settlements, which is what the atomic
// settlement claim depends on.

import { vi } from "vitest";

export const TB = "http://tb.test";
export const FINANCE = "http://finance.test";
export const GATEWAY = "https://www.paynow.co.zw";

/** JWT-ish token with a decodable username payload (same as the app's). */
export function tokenFor(username: string, admin = false): string {
  const payload = Buffer.from(JSON.stringify({ username, admin })).toString("base64url");
  return `h.${payload}.s`;
}

function decodeToken(token: string): { username?: string; admin?: boolean } {
  const part = token.split(".")[1] ?? "";
  try {
    return JSON.parse(Buffer.from(part, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

export interface OrderSeed {
  id: number;
  auction_id?: number;
  auction_title?: string;
  buyer_username: string;
  seller_username: string;
  final_price?: number;
  status?: string;
  pay_by?: string | null;
}

export interface SessionSeed {
  id: number;
  order_id: number;
  reference: string;
  amount: number;
  method?: string;
  phone?: string | null;
  status?: string;
  poll_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DbState {
  rows: Record<string, Record<string, unknown>[]>;
  users: Set<string>;
  admins: Set<string>;
  /** Gateway status per reference (what a poll / webhook would report). */
  gateway: Map<string, { status: string; amount?: string }>;
  gatewayPolls: Map<string, number>;
  financeEvents: Record<string, unknown>[];
  /** One-shot failure switches for crash simulation. */
  failOnce: { paymentsInsert?: boolean; orderPatch?: boolean };
  calls: { method: string; url: string; body?: string }[];
}

export function createDb(seeds?: { orders?: OrderSeed[]; sessions?: SessionSeed[] }): DbState {
  const now = "2026-11-27T00:00:00Z";
  const db: DbState = {
    rows: {
      orders: (seeds?.orders ?? []).map((o) => ({
        id: o.id,
        auction_id: o.auction_id ?? 1,
        auction_title: o.auction_title ?? "Test item",
        buyer_user: `user:${o.buyer_username}`,
        seller_user: `user:${o.seller_username}`,
        buyer_username: o.buyer_username,
        seller_username: o.seller_username,
        final_price: o.final_price ?? 10,
        status: o.status ?? "pending_payment",
        pay_by: o.pay_by ?? null,
        paid_at: null,
        created_at: now,
        updated_at: now,
      })),
      paynow_sessions: (seeds?.sessions ?? []).map((s) => ({
        id: s.id,
        order_id: s.order_id,
        reference: s.reference,
        amount: s.amount,
        method: s.method ?? "ecocash",
        phone: s.phone ?? null,
        status: s.status ?? "pending",
        poll_url: s.poll_url ?? null,
        redirect_url: null,
        paynow_hash: null,
        error: null,
        created_at: s.created_at ?? now,
        updated_at: s.updated_at ?? now,
      })),
      payments: [],
      notifications: [],
      audit_events: [],
      paynow_settlements: [],
      auctions: [{ id: 1, shipping_fee: 0 }],
    },
    users: new Set(["buyer1", "seller1", "mallory", "buyer2"]),
    admins: new Set(["admin1"]),
    gateway: new Map(),
    gatewayPolls: new Map(),
    financeEvents: [],
    failOnce: {},
    calls: [],
  };
  for (const o of seeds?.orders ?? []) {
    db.users.add(o.buyer_username);
    db.users.add(o.seller_username);
  }
  return db;
}

// ── records-API filtering (the subset the app uses) ────────────────────

type Op = "$eq" | "$lte" | "$gte" | "$gt";

function applyFilters(rows: Record<string, unknown>[], search: URLSearchParams) {
  let out = [...rows];
  for (const [key, value] of search.entries()) {
    const m = /^filter\[(\w+)\]\[(\$eq|\$lte|\$gte|\$gt)\]$/.exec(key);
    if (!m) continue;
    const [, field, op] = m;
    out = out.filter((row) => {
      const cell = row[field];
      if (op === "$eq") return String(cell) === value;
      const a = Date.parse(String(cell));
      const b = Date.parse(value);
      const an = Number(cell);
      const bn = Number(value);
      if (Number.isFinite(an) && Number.isFinite(bn) && !Number.isNaN(an)) {
        if (op === "$lte") return an <= bn;
        if (op === "$gte") return an >= bn;
        return an > bn;
      }
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (op === "$lte") return a <= b;
        if (op === "$gte") return a >= b;
        return a > b;
      }
      return false;
    });
  }
  const order = search.get("order") ?? "id";
  const desc = order.startsWith("-");
  const col = desc ? order.slice(1) : order;
  out.sort((x, y) => Number(x[col]) - Number(y[col]));
  if (desc) out.reverse();
  const limit = Number(search.get("limit") ?? "0");
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

// ── the fetch emulator ────────────────────────────────────────────────

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function installFetchMock(db: DbState): void {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    db.calls.push({ method, url, body });

    // ── Paynow gateway (poll URLs) ────────────────────────────────────
    if (url.startsWith(GATEWAY)) {
      const ref = new URL(url).searchParams.get("ref") ?? "";
      db.gatewayPolls.set(ref, (db.gatewayPolls.get(ref) ?? 0) + 1);
      const state = db.gateway.get(ref);
      if (!state) {
        return new Response("status=error", {
          status: 200,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      }
      const fields: Record<string, string> = { status: state.status };
      if (state.amount != null) fields.amount = state.amount;
      fields.paynowreference = `PN-${ref.slice(-6)}`;
      const form = new URLSearchParams(fields).toString();
      return new Response(form, {
        status: 200,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }

    // ── finance service (fire-and-forget order.paid events) ───────────
    if (url.startsWith(FINANCE)) {
      if (body) db.financeEvents.push(JSON.parse(body));
      return jsonRes({ ok: true });
    }

    if (!url.startsWith(TB)) return jsonRes({ error: "not found" }, 404);

    const u = new URL(url);
    const path = u.pathname;

    // ── auth endpoints ────────────────────────────────────────────────
    if (path === "/api/auth/v1/login" && method === "POST") {
      return jsonRes({ auth_token: "admin-token" });
    }
    if (path === "/api/auth/v1/status") {
      const header = (init?.headers as Record<string, string>)["Authorization"] ?? "";
      const token = header.replace(/^Bearer\s+/i, "");
      const payload = decodeToken(token);
      if (payload.username && db.users.has(payload.username)) {
        return jsonRes({ auth_token: token });
      }
      return jsonRes({ error: "unauthorized" }, 401);
    }

    // ── records API ──────────────────────────────────────────────────
    const rec = /^\/api\/records\/v1\/(\w+)(?:\/(\d+))?$/.exec(path);
    if (!rec) return jsonRes({ error: "not found" }, 404);
    const [, collection, idStr] = rec;
    const table = db.rows[collection] ?? (db.rows[collection] = []);

    if (method === "GET" && idStr) {
      // Order reads carry the CALLER's token — the canonical ACL check:
      // buyer / seller of the order row, or an admin, may read.
      const header = (init?.headers as Record<string, string>)["Authorization"] ?? "";
      const token = header.replace(/^Bearer\s+/i, "");
      if (token !== "admin-token") {
        const payload = decodeToken(token);
        const row = table.find((r) => String(r.id) === idStr);
        const allowed =
          !!row &&
          (payload.admin === true ||
            (collection === "orders" &&
              (row.buyer_username === payload.username ||
                row.seller_username === payload.username)));
        if (!allowed) return jsonRes({ error: "not found" }, 404);
      }
      const row = table.find((r) => String(r.id) === idStr);
      return row ? jsonRes(row) : jsonRes({ error: "not found" }, 404);
    }

    if (method === "GET") {
      return jsonRes({ records: applyFilters(table, u.searchParams) });
    }

    if (method === "POST") {
      const row = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      // UNIQUE(reference) on paynow_sessions / paynow_settlements — the
      // atomic settlement claim depends on this.
      if (collection === "paynow_sessions" || collection === "paynow_settlements") {
        const dup = table.some((r) => r.reference === row.reference);
        if (dup) return jsonRes({ error: "unique violation" }, 409);
      }
      if (collection === "payments" && db.failOnce.paymentsInsert) {
        db.failOnce.paymentsInsert = false;
        return jsonRes({ error: "boom" }, 500);
      }
      const id = table.reduce((m, r) => Math.max(m, Number(r.id) ?? 0), 0) + 1;
      table.push({ ...row, id });
      return jsonRes({ ids: [id] });
    }

    if (method === "PATCH" && idStr) {
      const row = table.find((r) => String(r.id) === idStr);
      if (!row) return jsonRes({ error: "not found" }, 404);
      if (collection === "orders" && db.failOnce.orderPatch) {
        db.failOnce.orderPatch = false;
        return jsonRes({ error: "boom" }, 500);
      }
      const patch = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      Object.assign(row, patch);
      return jsonRes({ ok: true });
    }

    return jsonRes({ error: "method not allowed" }, 405);
  };

  global.fetch = vi.fn(handler) as unknown as typeof fetch;
}

/** Count rows in a collection matching a predicate. */
export function count(db: DbState, collection: string, pred: (r: Record<string, unknown>) => boolean): number {
  return (db.rows[collection] ?? []).filter(pred).length;
}

/** Timestamp older than the sweep's 120s staleness window but inside the
 *  48h recovery window (computed against the real clock the sweep uses). */
export const OLD = new Date(Date.now() - 4 * 60 * 60 * 1000)
  .toISOString()
  .replace(/\.\d+Z$/, "Z");

/** Timestamp a few seconds old — a "fresh" settlement claim (< 120s). */
export const FRESH = new Date(Date.now() - 5 * 1000)
  .toISOString()
  .replace(/\.\d+Z$/, "Z");

/** Load fresh copies of the server modules (state, env re-read). */
export async function freshModules() {
  vi.resetModules();
  const paynow = await import("@/lib/server/paynow");
  const paynowOrder = await import("@/lib/server/paynow-order");
  const paynowReconcile = await import("@/lib/server/paynow-reconcile");
  return { paynow, paynowOrder, paynowReconcile };
}

/** A plain-Request stand-in for NextRequest (the routes only use the
 *  standard Request surface: headers/json/text/url). */
export function req(
  url: string,
  init: { method: string; body?: string; token?: string },
): unknown {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  return new Request(url, {
    method: init.method,
    headers,
    body: init.body,
  });
}

export function pollReq(body: unknown, token?: string): unknown {
  return req("http://localhost:3000/api/paynow/poll", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}
