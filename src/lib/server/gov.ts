// gov.ts — server-side BFF proxy for the govern-service (:3008).
//
// Every /api/gov/* and /api/compliance/* route funnels through one of the
// four proxies below (mirrors trust.ts, Task 12-c):
//   govPublicProxy   — NO auth: /public/* policy reader + acceptances.
//                      When the caller happens to be signed in their
//                      username is attached to the body (acceptances).
//   govProxy         — 401 unsigned → forward with x-tgs-user (/me/*).
//   adminGovProxy    — 401 unsigned, 403 non-admin (TrailBase admin claim)
//                      → forward with x-tgs-user + x-tgs-admin: 1.
//
// The service is lazily spawned via the services-spawn spec when /health
// fails (the :3008 watchdog also re-spawns it) → 503 with a clear message.
// The browser NEVER sees the govern port — all fetches stay relative.
// Contract: worklog Task 12-plan §B/§C/§F (govern-service :3008, owner 12-d).

import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromToken } from "./paynow-order";
import { ensureService } from "./services-spawn";
import path from "node:path";

const GOV_BASE = process.env.GOVERN_URL ?? "http://127.0.0.1:3008";
const GOV_TIMEOUT_MS = 20_000;

// Mirror of the govern-service spec in services-spawn.ts (frozen file — the
// spec object is duplicated here so this module stays self-contained).
const GOV_SPEC = {
  name: "govern-service",
  port: 3008,
  cwd: path.join(process.cwd(), "mini-services", "govern-service"),
  command: "bun",
  args: ["run", "dev"],
  bootTimeoutMs: 15_000,
  logFile: path.join(process.cwd(), "dev-govern.log"),
  requireDir: true,
} as const;

export function govJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

async function govHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${GOV_BASE}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure the govern-service answers /health, lazily spawning it when down. */
export async function ensureGovernService(): Promise<boolean> {
  // The container boots the service itself; on a cold start (Fly resume) it can
  // be a few seconds behind the app. Poll briefly instead of failing the first
  // request with "Governance service is starting up".
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await govHealthy(800)) return true;
    if (attempt === 0) {
      try {
        await ensureService(GOV_SPEC as unknown as Parameters<typeof ensureService>[0]);
      } catch (err) {
        console.error("[api/gov] spawn failed:", err);
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

interface ProxyOpts {
  /** Already-parsed JSON body (when the route read req.json() for validation). */
  body?: unknown;
  /** Force the forwarded method (e.g. DELETE bodies). */
  methodOverride?: string;
  /** Extra query string to append (the path may already carry one). */
  query?: string;
  /** Response header overrides (CSV / JSON downloads). */
  responseHeaders?: Record<string, string>;
}

async function proxy(
  req: NextRequest,
  servicePath: string,
  headers: Record<string, string>,
  opts: ProxyOpts,
): Promise<NextResponse> {
  const healthy = await ensureGovernService();
  if (!healthy) {
    return govJson(
      { ok: false, error: "Governance service is starting up — try again in a moment." },
      503,
    );
  }
  const method = (opts.methodOverride ?? req.method).toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers: {
      ...headers,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(GOV_TIMEOUT_MS),
    cache: "no-store",
  };
  if (hasBody) {
    init.body = opts.body !== undefined ? JSON.stringify(opts.body) : await req.text();
  }
  const qs = opts.query ? (servicePath.includes("?") ? `&${opts.query}` : `?${opts.query}`) : "";
  try {
    const res = await fetch(`${GOV_BASE}${servicePath}${qs}`, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        ...(opts.responseHeaders ?? {}),
      },
    });
  } catch (err) {
    console.error("[api/gov] proxy failure:", err);
    return govJson(
      { ok: false, error: "The governance service is unreachable right now." },
      502,
    );
  }
}

/** Public route: NO auth — /public/policies* renders signed-out too. */
export async function govPublicProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  return proxy(req, servicePath, {}, opts);
}

/** Public-with-identity route: never 401s, but attaches the caller's
 *  username to the JSON body when a valid token is present (acceptances). */
export async function govAcceptanceProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  const body =
    opts.body !== undefined
      ? (opts.body as Record<string, unknown>)
      : await req.json().catch(() => ({}));
  const merged: Record<string, unknown> = {
    ...(typeof body === "object" && body !== null ? body : {}),
    ...(user && !body?.username ? { username: user.username } : {}),
    surface: body?.surface ?? "policy_page",
  };
  return proxy(req, servicePath, {}, { ...opts, body: merged });
}

/** User route: 401 unsigned → forward with x-tgs-user. */
export async function govProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return govJson({ ok: false, error: "Sign in to use the Privacy Centre." }, 401);
  }
  return proxy(req, servicePath, { "x-tgs-user": user.username }, opts);
}

/** Admin route: 401 unsigned, 403 non-admin → forward with both headers. */
export async function adminGovProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return govJson({ ok: false, error: "Sign in to manage governance." }, 401);
  }
  if (!user.admin) {
    return govJson({ ok: false, error: "Admins only — this area is restricted." }, 403);
  }
  return proxy(req, servicePath, { "x-tgs-user": user.username, "x-tgs-admin": "1" }, opts);
}
