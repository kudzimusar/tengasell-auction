// govern-service — Tengasell governance plane (port 3008).
//
// Versioned bilingual policy CMS with editorial workflow (draft → review →
// approve → publish/rollback), the Privacy Centre / DSAR engine (access,
// correction, deletion, portability, restriction, objection) with legal-hold
// blocking, the data + processor registers, the generic corporate/regulatory
// register engine, incident management with RCA, the risk register with
// time-bounded exceptions, the legal request/hold workflow, the decision log
// (ADRs) and the 609-control MSCS compliance register seeded from the
// canonical worksheet.
//
// Auth model (mirrors comms-service): the Next BFF sets `x-tgs-user` for /me
// endpoints and `x-tgs-admin: 1` for /admin endpoints; /public/* needs nothing.

import { PORT, DB_PATH } from "./config";
import { all, get, run, scalar, nowSqlite } from "./db"; // module load runs migrations
import { seed } from "./seed";
import { HttpError, type Ctx, type Method, type RouteHandler } from "./http";
import { registerPublicRoutes } from "./routes/public";
import { registerPolicyRoutes } from "./routes/policies";
import { registerPrivacyRoutes } from "./routes/privacy";
import { registerRegisterRoutes } from "./routes/registers";
import { registerIncidentRoutes } from "./routes/incidents";
import { registerRiskRoutes } from "./routes/risks";
import { registerLegalRoutes } from "./routes/legal";
import { registerDecisionRoutes } from "./routes/decisions";
import { registerComplianceRoutes } from "./routes/compliance";

// ── Boot: idempotent seed ────────────────────────────────────────────────────

const seeded = seed();

// ── Router ──────────────────────────────────────────────────────────────────

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

registerPublicRoutes(on);
registerPolicyRoutes(on);
registerPrivacyRoutes(on);
registerRegisterRoutes(on);
registerIncidentRoutes(on);
registerRiskRoutes(on);
registerLegalRoutes(on);
registerDecisionRoutes(on);
registerComplianceRoutes(on);

// ── Health ───────────────────────────────────────────────────────────────────

function healthPayload() {
  return {
    status: "ok",
    service: "govern",
    port: PORT,
    db: "ok",
    db_path: DB_PATH,
    policies: scalar(`SELECT COUNT(*) FROM policies`),
    published: scalar(`SELECT COUNT(*) FROM policies WHERE status = 'published'`),
    privacy_requests: scalar(`SELECT COUNT(*) FROM privacy_requests`),
    controls: scalar(`SELECT COUNT(*) FROM controls`),
    legal_holds_active: scalar(`SELECT COUNT(*) FROM legal_holds WHERE lifted_at IS NULL`),
    seeded,
  };
}

// ── Scheduled publish sweep (CMS-015) ────────────────────────────────────────

function sweepScheduledPublishes(): void {
  const due = all<{ key: string; current_version: number }>(
    `SELECT key, current_version FROM policies
     WHERE status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for <= datetime('now')`,
  );
  for (const p of due) {
    const ts = nowSqlite();
    run(
      `UPDATE policy_versions SET published_at = ?, published_by = 'scheduled-sweep' WHERE policy_key = ? AND version = ? AND published_at IS NULL`,
      [ts, p.key, p.current_version],
    );
    run(`UPDATE policies SET status = 'published', scheduled_for = NULL, updated_at = datetime('now') WHERE key = ?`, [p.key]);
    run(
      `INSERT INTO content_audit(policy_key, action, version, actor, detail) VALUES('publish', ?, 'scheduled-sweep', ?, ?)`,
      [p.key, p.current_version, `scheduled publish fired at ${ts}`],
    );
    console.log(`[govern] scheduled publish: ${p.key} v${p.current_version}`);
  }
}
setInterval(sweepScheduledPublishes, 60_000).unref?.();
sweepScheduledPublishes();

// ── Request handling (mirror comms-service) ─────────────────────────────────

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
  console.error("[govern] unexpected error:", e);
  return jsonOut({ error: "internal govern error" }, 500);
}

/** Contract logging: "METHOD /path status ms". */
function logRequest(method: string, path: string, status: number, started: number): void {
  console.log(`${method} ${path} ${status} ${Date.now() - started}ms`);
}

// ── Server ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    return handleRequest(req);
  },
});

console.log(
  `[govern] governance plane listening on http://localhost:${PORT} — db=${DB_PATH} ` +
    `policies=${seeded.policies}v-rows acceptances=${seeded.acceptances} ` +
    `registers=${seeded.registerEntries} risks=${seeded.risks} incidents=${seeded.incidents} ` +
    `controls=${seeded.controls}`,
);
