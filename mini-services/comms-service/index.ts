// TUCS core — Tengasell Unified Communications System (port 3005).
//
// Multi-channel communications (Email, Telegram, WhatsApp, Messenger) with
// mediated user→user messaging, a moderation pipeline, notification fan-out,
// an inbox-marketing campaign engine, mock channel simulators and admin
// viewers. Providers auto-detect mode from env — absent credentials ⇒ fully
// functional mocks (no network calls).
//
// Auth model: the Next BFF sets `x-tgs-user: <username>` for user endpoints and
// `x-tgs-admin: 1` for admin endpoints; /hooks/* are public webhooks.

import { PORT, DB_PATH } from "./config";
import { db, scalar } from "./db"; // module load runs idempotent migrations
import { seedTemplates } from "./templates";
import { startSweeper } from "./queue";
import { providerLabels } from "./providers";
import { HttpError, type Ctx, type Method, type RouteHandler } from "./http";
import { registerMeRoutes } from "./routes/me";
import { registerEventRoutes } from "./routes/events";
import { registerAdminRoutes } from "./routes/admin";
import { registerHookRoutes } from "./routes/hooks";

// ── Boot ───────────────────────────────────────────────────────────────────────

const seeded = seedTemplates();
startSweeper(10_000);

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
registerHookRoutes(on);

// ── Health (contract section B) ───────────────────────────────────────────────

function healthPayload() {
  const depth = scalar(`SELECT COUNT(*) AS n FROM outbound_queue WHERE status IN('queued','sending')`);
  const sent24h = scalar(
    `SELECT COUNT(*) AS n FROM outbound_queue WHERE status = 'sent' AND datetime(COALESCE(sent_at, created_at)) >= datetime('now', '-24 hours')`,
  );
  const failed = scalar(`SELECT COUNT(*) AS n FROM outbound_queue WHERE status IN('failed','dead')`);
  return {
    status: "ok",
    service: "comms",
    port: PORT,
    providers: providerLabels(),
    queue: { depth, sent24h, failed },
    db: "ok",
  };
}

// ── Request handling ───────────────────────────────────────────────────────────

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
  console.error("[comms] unexpected error:", e);
  return jsonOut({ error: "internal comms error" }, 500);
}

/** Contract logging: "METHOD /path status ms". */
function logRequest(method: string, path: string, status: number, started: number): void {
  console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
}

// ── Server ─────────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    return handleRequest(req);
  },
});

console.log(
  `[comms] TUCS core listening on http://localhost:${PORT} — db=${DB_PATH} ` +
    `providers=email:${providerLabels().email} telegram:${providerLabels().telegram} ` +
    `whatsapp:${providerLabels().whatsapp} messenger:${providerLabels().messenger} ` +
    `templates_seeded=${seeded.rows}`,
);
