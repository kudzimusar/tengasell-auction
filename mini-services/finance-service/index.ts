// Tengasell finance-service — the money layer (port 3006, MSCS 12-b).
//
// Double-entry ledger · escrow · final-value fees + VAT · seller balances ·
// payouts (KYC + dual approval + sanctions confirm) · refunds + credit
// notes · chargebacks · invoices · receipts · bank reconciliation lite ·
// VAT tax packs · reconciliation tie-out against TrailBase (:3001).
//
// Auth model: the Next BFF sets `x-tgs-user: <username>` for user endpoints
// and `x-tgs-admin: 1` for admin endpoints. POST /events is internal
// (trade-engine, fire-and-forget); POST /internal/refund requires the
// shared `x-tgs-internal` header (§F).
//
// A 60s internal sweep self-heals the ledger against TrailBase:
//   · funds escrow for paid orders the events missed (any payment path),
//   · opens dispute windows for delivered orders,
//   · releases escrow when the dispute window elapses,
//   · reverses escrow for cancelled orders,
//   · refreshes the cached seller balances.

import { PORT, DB_PATH, INTERNAL_TOKEN } from "./config";
import { all, scalar } from "./db"; // module load runs idempotent migrations
import { HttpError, type Ctx, type Method, type RouteHandler } from "./http";
import { toCents } from "./util";
import {
  fundEscrow,
  startDisputeWindow,
  releaseEscrow,
  cancelEscrow,
  orderFinanceById,
  refreshSellerBalance,
  verifyLedger,
} from "./money";
import { tbListOrders, tbGetAuction } from "./trailbase";
import { registerMeRoutes } from "./routes/me";
import { registerEventRoutes } from "./routes/events";
import { registerAdminRoutes } from "./routes/admin";

// ── Router ──────────────────────────────────────────────────────────────────────

interface CompiledRoute {
  method: Method;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
}

function compilePattern(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${src}/?$`), keys };
}

const routes: CompiledRoute[] = [];

function on(method: Method, pattern: string, handler: RouteHandler): void {
  const { regex, keys } = compilePattern(pattern);
  routes.push({ method, regex, keys, handler });
}

on("GET", "/health", () => healthPayload());

registerMeRoutes(on);
registerEventRoutes(on);
registerAdminRoutes(on);

// ── Health ──────────────────────────────────────────────────────────────────────

function healthPayload() {
  const ledgerEntries = scalar(`SELECT COUNT(*) AS n FROM ledger_entries`);
  const escrowHolding = scalar(
    `SELECT COALESCE(SUM(escrow_cents),0) AS n FROM order_finance WHERE status IN('holding','partial')`,
  );
  const payoutsPending = scalar(`SELECT COUNT(*) AS n FROM payouts WHERE status IN('requested','approved')`);
  const integrity = verifyLedger();
  return {
    status: "ok",
    service: "finance",
    port: PORT,
    db: "ok",
    ledger: { entries: ledgerEntries, balancedTxs: integrity.transactions, verify: integrity.ok ? "ok" : "fail" },
    escrow: { holdingCents: escrowHolding },
    payouts: { pending: payoutsPending },
  };
}

// ── Request handling ────────────────────────────────────────────────────────────

function jsonOut(body: unknown, status = 200, contentType = "application/json; charset=utf-8"): Response {
  const payload =
    contentType.startsWith("text/csv") ? String(body ?? "") : JSON.stringify(body ?? { ok: true });
  return new Response(payload, { status, headers: { "Content-Type": contentType } });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const started = Date.now();

  try {
    const match = findRoute(req.method, url.pathname);
    if (!match) throw new HttpError(404, "not found", "not_found");

    let rawBody: string | null = null;
    let body: Record<string, unknown> | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      rawBody = await req.text();
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          } else {
            body = { _root: parsed };
          }
        } catch {
          throw new HttpError(400, "invalid JSON body", "invalid_json");
        }
      }
    }

    const user = req.headers.get("x-tgs-user");
    const admin = req.headers.get("x-tgs-admin") === "1";
    const internal = req.headers.get("x-tgs-internal");
    const params: Record<string, string> = {};
    const groups = url.pathname.match(match.regex);
    match.keys.forEach((k, i) => {
      params[k] = groups?.[i + 1] ? decodeURIComponent(groups[i + 1]) : "";
    });

    const ctx: Ctx = {
      req,
      url,
      params,
      body,
      rawBody,
      user,
      admin,
      requireUser() {
        if (!user) throw new HttpError(401, "x-tgs-user header required", "unauthorized");
        return user;
      },
      requireAdmin() {
        if (!admin) throw new HttpError(401, "x-tgs-admin: 1 header required", "forbidden");
      },
      requireInternal() {
        if (internal !== INTERNAL_TOKEN) {
          throw new HttpError(401, "x-tgs-internal header required", "unauthorized");
        }
      },
    };

    const out = await match.handler(ctx);
    const contentType =
      url.pathname === "/admin/tax" && url.searchParams.get("format") === "csv"
        ? "text/csv; charset=utf-8"
        : "application/json; charset=utf-8";
    const res = jsonOut(out, 200, contentType);
    logRequest(req.method, url.pathname, res.status, started);
    return res;
  } catch (e) {
    const res = errorResponse(e);
    logRequest(req.method, url.pathname, res.status, started);
    return res;
  }
}

function findRoute(method: string, pathname: string): CompiledRoute | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.regex.test(pathname)) return r;
  }
  return null;
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return jsonOut({ error: e.message, code: e.code ?? undefined }, e.status);
  }
  console.error("[finance] unexpected error:", e);
  return jsonOut({ error: "internal finance error" }, 500);
}

/** Contract logging: "METHOD /path status ms". */
function logRequest(method: string, path: string, status: number, started: number): void {
  console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
}

// ── The 60s self-heal sweep ─────────────────────────────────────────────────────

async function sweep(): Promise<void> {
  // 1. release escrows whose dispute window elapsed
  const due = all<{ order_id: number }>(
    `SELECT order_id FROM order_finance
     WHERE status = 'holding' AND dispute_window_ends IS NOT NULL
       AND dispute_window_ends <= datetime('now')`,
  );
  for (const r of due) releaseEscrow(r.order_id);

  // 2. reconcile with TrailBase (backfill missed funding, windows, cancels)
  const orders = await tbListOrders(200).catch(() => null);
  if (!orders) return;
  for (const o of orders) {
    const orderId = Number(o.id);
    const status = String(o.status);
    const fin = orderFinanceById(orderId);
    const paid = ["paid", "shipped", "delivered", "completed"].includes(status);

    if (paid && o.paid_at && !fin) {
      const auction = await tbGetAuction(Number(o.auction_id)).catch(() => null);
      fundEscrow({
        orderId,
        buyer: String(o.buyer_username ?? ""),
        seller: String(o.seller_username ?? ""),
        itemPriceCents: toCents(Number(o.final_price ?? 0)),
        shippingCents: toCents(Number(auction?.shipping_fee ?? 0)),
        method: "sweep:backfill",
        paidAt: o.paid_at,
        actor: "system:sweep",
      });
      continue;
    }
    if (!fin) continue;

    if ((status === "delivered" || status === "completed") && fin.status === "holding" && !fin.dispute_window_ends) {
      startDisputeWindow(orderId, o.delivered_at ?? o.completed_at ?? null);
    }
    if (status === "cancelled" && (fin.status === "holding" || fin.status === "partial")) {
      cancelEscrow(orderId, "system:sweep", "order cancelled in TrailBase");
    }
  }

  // 3. refresh cached balances for every known seller
  const sellers = all<{ username: string }>(`SELECT DISTINCT username FROM (
    SELECT seller AS username FROM order_finance
    UNION SELECT username FROM payouts
  )`);
  for (const s of sellers) refreshSellerBalance(s.username);
}

// ── Server ──────────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    return handleRequest(req);
  },
});

setInterval(() => {
  void sweep().catch((err) => console.error("[finance] sweep error:", (err as Error).message));
}, 60_000);
// first sweep shortly after boot (lets TrailBase settle)
setTimeout(() => {
  void sweep().catch((err) => console.error("[finance] boot sweep error:", (err as Error).message));
}, 5_000);

console.log(`[finance] money layer listening on http://localhost:${PORT} — db=${DB_PATH}`);
