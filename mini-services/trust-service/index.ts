// Trust-service — Tengasell Support & Trust plane (port 3007, MSCS 12-c).
//
// Owns: support tickets (intake, SLA clocks, assignment, internal notes,
// macros, attachments, CSAT), abuse reports → cases, the enforcement ladder
// (warning → restriction → suspension → ban with DUAL APPROVAL for bans +
// >7d suspensions), appeals + reinstatement, staff RBAC role rows, MFA
// (TOTP) state, listing screening + takedown, and the on-demand seller
// health score. SQLite: /home/z/my-project/db/trust.db (bun:sqlite, WAL).
//
// Auth model (mirror comms-service): the Next BFF sets `x-tgs-user` for user
// endpoints and `x-tgs-admin: 1` for admin endpoints; /internal/* callers
// authenticate with the shared secret header `x-tgs-internal`.

import { PORT, DB_PATH, INTERNAL_SECRET } from "./config";
import { db, scalar } from "./db"; // module load runs idempotent migrations
import { HttpError, type Ctx, type Method, type RouteHandler } from "./http";
import { registerInternalRoutes } from "./routes/internal";
import { registerMfaRoutes } from "./routes/mfa";
import { registerMeRoutes } from "./routes/me";
import { registerAdminRoutes } from "./routes/admin";

// ── Router (mirror comms index.ts) ─────────────────────────────────────────

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

registerInternalRoutes(on);
registerMfaRoutes(on);
registerMeRoutes(on);
registerAdminRoutes(on);

// ── Health ────────────────────────────────────────────────────────────────

function healthPayload() {
  return {
    status: "ok",
    service: "trust",
    port: PORT,
    db: "ok",
    counts: {
      tickets: scalar(`SELECT COUNT(*) AS n FROM tickets`),
      reports: scalar(`SELECT COUNT(*) AS n FROM reports`),
      cases: scalar(`SELECT COUNT(*) AS n FROM cases`),
      enforcement: scalar(`SELECT COUNT(*) AS n FROM enforcement`),
      screening_rules: scalar(`SELECT COUNT(*) AS n FROM screening_rules`),
      screening_pending: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'pending'`),
    },
  };
}

// ── Request handling ──────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

function jsonOut(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? { ok: true }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const started = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const match = findRoute(req.method, url.pathname);
    if (!match) throw new HttpError(404, "not found", "not_found");

    let body: Record<string, unknown> | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const rawBody = await req.text();
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
    const internal = req.headers.get("x-tgs-internal") === INTERNAL_SECRET;
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
      user,
      admin,
      internal,
      requireUser() {
        if (!user) throw new HttpError(401, "x-tgs-user header required", "unauthorized");
        return user;
      },
      requireAdmin() {
        if (!admin) throw new HttpError(401, "x-tgs-admin: 1 header required", "forbidden");
        return user ?? "admin";
      },
      requireInternal() {
        if (!internal) {
          throw new HttpError(401, "x-tgs-internal header required", "unauthorized");
        }
      },
    };

    const out = await match.handler(ctx);
    const res = jsonOut(out);
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
  console.error("[trust] unexpected error:", e);
  return jsonOut({ error: "internal trust error" }, 500);
}

/** Contract logging: "METHOD /path status ms". */
function logRequest(method: string, path: string, status: number, started: number): void {
  console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
}

// ── Server ────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    return handleRequest(req);
  },
});

console.log(
  `[trust] Support & Trust service listening on http://localhost:${PORT} — db=${DB_PATH} ` +
    `routes=${routes.length} (internal|mfa|me|admin)`,
);
