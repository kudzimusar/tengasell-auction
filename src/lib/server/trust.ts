// trust.ts — server-side BFF proxy for the trust-service (:3007).
//
// Every /api/trust/* route funnels through trustProxy() / adminTrustProxy():
//   1. Authenticate the caller from their TrailBase token (the same helper
//      the comms BFF uses — resolveUserFromToken → 401 when not signed in).
//   2. Ensure the trust-service is alive (TCP probe + lazy spawn via the
//      services-spawn spec — the :3007 watchdog also re-spawns it) → 503
//      with a clear message when it cannot come up.
//   3. Forward method + body + query to http://127.0.0.1:3007{path} with the
//      pinned user header `x-tgs-user: <username>`; admin routes additionally
//      require the TrailBase admin claim and pin `x-tgs-admin: 1` (403
//      otherwise — per-role NARROWING is wired by 12-e using
//      GET /internal/status; see agent-ctx/12-c-trust.md for the mapping).
//
// The browser NEVER sees the trust port — all fetches stay relative
// (/api/trust/…). Contract: worklog Task 12-plan §B/§C/§F.

import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromToken } from "./paynow-order";
import { ensureService } from "./services-spawn";
import path from "node:path";

const TRUST_BASE = process.env.TRUST_URL ?? "http://127.0.0.1:3007";
const TRUST_TIMEOUT_MS = 15_000;

// Mirror of the trust-service spec in services-spawn.ts (frozen file — the
// spec object is duplicated here so this module stays self-contained).
const TRUST_SPEC = {
  name: "trust-service",
  port: 3007,
  cwd: path.join(process.cwd(), "mini-services", "trust-service"),
  command: "bun",
  args: ["run", "dev"],
  bootTimeoutMs: 15_000,
  logFile: path.join(process.cwd(), "dev-trust.log"),
  requireDir: true,
} as const;

export function trustJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

async function trustHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${TRUST_BASE}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure the trust-service answers /health, lazily spawning it when down. */
export async function ensureTrustService(): Promise<boolean> {
  if (await trustHealthy()) return true;
  try {
    await ensureService(TRUST_SPEC as unknown as Parameters<typeof ensureService>[0]);
  } catch (err) {
    console.error("[api/trust] spawn failed:", err);
  }
  return trustHealthy(3000);
}

interface ProxyOpts {
  /** Already-parsed JSON body (when the route read req.json() for validation). */
  body?: unknown;
  /** Force the forwarded method (e.g. DELETE bodies). */
  methodOverride?: string;
  /** Extra query string to append (the path may already carry one). */
  query?: string;
}

async function proxy(
  req: NextRequest,
  servicePath: string,
  headers: Record<string, string>,
  opts: ProxyOpts,
): Promise<NextResponse> {
  const healthy = await ensureTrustService();
  if (!healthy) {
    return trustJson(
      { ok: false, error: "Support & Trust service is starting up — try again in a moment." },
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
    signal: AbortSignal.timeout(TRUST_TIMEOUT_MS),
    cache: "no-store",
  };
  if (hasBody) {
    init.body = opts.body !== undefined ? JSON.stringify(opts.body) : await req.text();
  }
  const qs = opts.query ? (servicePath.includes("?") ? `&${opts.query}` : `?${opts.query}`) : "";
  try {
    const res = await fetch(`${TRUST_BASE}${servicePath}${qs}`, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/trust] proxy failure:", err);
    return trustJson(
      { ok: false, error: "Support & Trust service is unreachable right now." },
      502,
    );
  }
}

/** User route: 401 unsigned → forward with x-tgs-user. */
export async function trustProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return trustJson({ ok: false, error: "Sign in to use Support & Trust." }, 401);
  }
  return proxy(req, servicePath, { "x-tgs-user": user.username }, opts);
}

/** Admin route: 401 unsigned, 403 non-admin → forward with both headers. */
export async function adminTrustProxy(
  req: NextRequest,
  servicePath: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return trustJson({ ok: false, error: "Sign in to manage Support & Trust." }, 401);
  }
  if (!user.admin) {
    return trustJson({ ok: false, error: "Admins only — this area is restricted." }, 403);
  }
  return proxy(req, servicePath, { "x-tgs-user": user.username, "x-tgs-admin": "1" }, opts);
}
