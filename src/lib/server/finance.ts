// finance.ts — server-side BFF proxy for the finance-service (:3006).
//
// Every /api/finance/* route funnels through financeProxy():
//   1. Authenticate the caller from their TrailBase token (same helper as
//      the paynow/comms routes — resolveUserFromToken → 401 unsigned).
//   2. Lazy-spawn + health-gate the finance-service (geo-spawn pattern:
//      the child lives in the persistent dev-server process tree, so it
//      survives agent-shell reaping) → 503 when it cannot come up.
//   3. Forward method + body + query to http://127.0.0.1:3006{path} with
//      the pinned headers x-tgs-user (and x-tgs-admin: 1 for admin routes).
//
// The browser NEVER sees the finance port — all fetches stay relative
// (/api/finance/…). Contract: worklog Task 12-plan §B/§F + Task 12-b.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { resolveUserFromToken } from "./paynow-order";

const FINANCE_PORT = Number(process.env.FINANCE_PORT ?? 3006);
const FINANCE_BASE = process.env.FINANCE_URL ?? "http://127.0.0.1:3006";
const FINANCE_DIR = path.join(process.cwd(), "mini-services", "finance-service");
const FINANCE_LOG = path.join(process.cwd(), "dev-finance.log");
const FINANCE_TIMEOUT_MS = 20_000;

// ── lazy spawner (geo-spawn.ts pattern — children of the dev-server
// process tree survive the sandbox's per-call reaping) ──────────────────

let spawning: Promise<void> | null = null;

function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function spawnFinance(): Promise<void> {
  try {
    if (await isPortOpen(FINANCE_PORT)) return;
    if (!fs.existsSync(path.join(FINANCE_DIR, "index.ts"))) {
      console.warn(`[api/finance] folder ${FINANCE_DIR} does not exist yet — skipping spawn`);
      return;
    }
    const fd = fs.openSync(FINANCE_LOG, "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd: FINANCE_DIR,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env },
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isPortOpen(FINANCE_PORT)) {
        console.log(`[api/finance] finance-service is up on :${FINANCE_PORT} (pid ${child.pid})`);
        return;
      }
    }
    console.warn(`[api/finance] finance-service did not bind :${FINANCE_PORT} — see ${FINANCE_LOG}`);
  } catch (err) {
    console.error("[api/finance] failed to spawn finance-service:", err);
  }
}

async function financeHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${FINANCE_BASE}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure the finance service is healthy, lazily spawning it when down. */
export async function ensureFinanceService(): Promise<boolean> {
  if (await financeHealthy()) return true;
  spawning ??= spawnFinance().finally(() => {
    spawning = null;
  });
  await spawning;
  return financeHealthy();
}

// ── proxies ────────────────────────────────────────────────────────────

export function financeJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

interface ProxyOpts {
  /** Already-parsed JSON body — pass when the route read req.json() for
   *  validation (a Request body can only be read once). */
  body?: unknown;
  /** Force the forwarded method (e.g. GET after a mutation re-read). */
  methodOverride?: string;
  /** Extra response headers (e.g. Content-Disposition for CSV exports). */
  extraHeaders?: Record<string, string>;
}

async function proxy(
  req: NextRequest,
  path: string,
  adminGate: boolean,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return financeJson({ ok: false, error: "Sign in to manage your money." }, 401);
  }
  if (adminGate && !user.admin) {
    return financeJson({ ok: false, error: "Admins only — this area is restricted." }, 403);
  }

  if (!(await ensureFinanceService())) {
    return financeJson(
      { ok: false, error: "Finance service is starting up — try again in a moment." },
      503,
    );
  }

  const method = (opts.methodOverride ?? req.method).toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers: {
      "x-tgs-user": user.username,
      ...(adminGate ? { "x-tgs-admin": "1" } : {}),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(FINANCE_TIMEOUT_MS),
    cache: "no-store",
  };
  if (hasBody) {
    init.body = opts.body !== undefined ? JSON.stringify(opts.body) : await req.text();
  }

  try {
    const res = await fetch(`${FINANCE_BASE}${path}`, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        ...(opts.extraHeaders ?? {}),
      },
    });
  } catch (err) {
    console.error("[api/finance] proxy failure:", err);
    return financeJson({ ok: false, error: "Finance service is unreachable right now." }, 502);
  }
}

/** User-scoped proxy (x-tgs-user only). */
export async function financeProxy(
  req: NextRequest,
  path: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  return proxy(req, path, false, opts);
}

/** Admin proxy (x-tgs-user + x-tgs-admin: 1; 403 for non-admins). */
export async function adminFinanceProxy(
  req: NextRequest,
  path: string,
  opts: ProxyOpts = {},
): Promise<NextResponse> {
  return proxy(req, path, true, opts);
}
