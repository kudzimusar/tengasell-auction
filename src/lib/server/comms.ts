// comms.ts — server-side BFF proxy for the TUCS comms-service (:3005).
//
// Every /api/comms/* route funnels through commsProxy():
//   1. Authenticate the caller from their TrailBase token (the SAME helper
//      the paynow routes use — resolveUserFromToken → 401 when not signed in).
//   2. Lazy-spawn / health-check the comms-service (port 3005, watchdog in
//      services-spawn.ts) → 503 with a clear message when it cannot come up.
//   3. Forward method + body + query to http://127.0.0.1:3005{path} with the
//      pinned user header `x-tgs-user: <username>` and pipe the JSON back.
//
// The browser NEVER sees the comms port — all fetches stay relative
// (/api/comms/…). Contract: worklog Task 11-plan section B.

import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromToken } from "./paynow-order";
import { ensureCommsService } from "./services-spawn";

const COMMS_BASE = process.env.COMMS_URL ?? "http://127.0.0.1:3005";

const COMMS_TIMEOUT_MS = 10_000;

export function commsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Proxy a /api/comms request to the comms-service.
 *
 * @param req     the incoming Next request (Authorization header required)
 * @param path    comms-service path, INCLUDING query string (e.g. "/me/links",
 *                "/me/links/12/verify", "/me/notifications?limit=20")
 * @param body    already-parsed JSON body — pass this when the route read
 *                req.json() for validation (a Request body can only be read
 *                once, so the proxy must not re-read the stream).
 * @param methodOverride force the forwarded method (e.g. "GET" when a POST
 *                route wants to re-read a resource after the mutation — the
 *                incoming request is POST, so the default would try to
 *                re-read the already-consumed body and crash).
 */
export async function commsProxy(
  req: NextRequest,
  path: string,
  body?: unknown,
  methodOverride?: string,
): Promise<NextResponse> {
  // ── 1. auth: same session helper as /api/paynow/* ──────────────────
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return commsJson(
      { ok: false, error: "Sign in to manage your communications." },
      401,
    );
  }

  // ── 2. ensure the comms-service is alive (lazy spawn + health) ────
  const healthy = await ensureCommsService();
  if (!healthy) {
    return commsJson(
      {
        ok: false,
        error:
          "Communications service is starting up — try again in a moment.",
      },
      503,
    );
  }

  // ── 3. forward to :3005 with the pinned user header ───────────────
  const method = (methodOverride ?? req.method).toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers: {
      "x-tgs-user": user.username,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(COMMS_TIMEOUT_MS),
    cache: "no-store",
  };
  if (hasBody) {
    init.body = body !== undefined ? JSON.stringify(body) : await req.text();
  }

  try {
    const res = await fetch(`${COMMS_BASE}${path}`, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/comms] proxy failure:", err);
    return commsJson(
      { ok: false, error: "Communications service is unreachable right now." },
      502,
    );
  }
}

/**
 * Proxy a /api/comms/admin request to the comms-service ADMIN endpoints.
 * Same contract as commsProxy plus the admin gate: the signed-in TrailBase
 * user must carry the `admin` flag (decoded from their verified JWT — the
 * same role convention every admin-only surface in the app relies on).
 * Non-admins get 403, unsigned callers 401. On success the request is
 * forwarded with BOTH pinned headers:
 *   x-tgs-user: <username>   x-tgs-admin: 1
 * (the comms-service 401s /admin/* without x-tgs-admin: 1).
 */
export async function adminCommsProxy(
  req: NextRequest,
  path: string,
  body?: unknown,
  methodOverride?: string,
): Promise<NextResponse> {
  const user = await resolveUserFromToken(req.headers.get("authorization"));
  if (!user) {
    return commsJson(
      { ok: false, error: "Sign in to manage communications." },
      401,
    );
  }
  if (!user.admin) {
    return commsJson(
      { ok: false, error: "Admins only — this area is restricted." },
      403,
    );
  }

  const healthy = await ensureCommsService();
  if (!healthy) {
    return commsJson(
      {
        ok: false,
        error: "Communications service is starting up — try again in a moment.",
      },
      503,
    );
  }

  const method = (methodOverride ?? req.method).toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit = {
    method,
    headers: {
      "x-tgs-user": user.username,
      "x-tgs-admin": "1",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(COMMS_TIMEOUT_MS),
    cache: "no-store",
  };
  if (hasBody) {
    init.body = body !== undefined ? JSON.stringify(body) : await req.text();
  }

  try {
    const res = await fetch(`${COMMS_BASE}${path}`, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/comms/admin] proxy failure:", err);
    return commsJson(
      { ok: false, error: "Communications service is unreachable right now." },
      502,
    );
  }
}
