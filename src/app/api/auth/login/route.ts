// POST /api/auth/login — BFF sign-in gate (MSCS 12-e: IAM-004/007/017, EXP gate).
//
// The sign-in form never talks to TrailBase auth directly:
//   1. server-side TrailBase login (password stays off the client wire)
//   2. SUSPENSION GATE — trust-service /internal/status (fail-open with a
//      throttled warning while trust is provisioning: engine-down safety)
//   3. MFA GATE — TrailBase-native TOTP: a 403 + {mfa_token} challenge is
//      returned instead of the session token; the token is only issued after
//      /api/auth/mfa/verify validates the 6-digit code (real gate at the
//      token authority). A trust-owned MFA policy (mfa_active with no
//      TrailBase challenge) gates through trust /mfa/verify instead.
// Only when every gate passes does the client receive the auth_token.

import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  clientUa,
  putPendingTrustMfa,
  trustStatus,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";
import { rateLimit } from "@/lib/server/auth-core";

// ── Credential-bruteforce throttle (DAST gap8-g6 finding #2) ──────────
// Two buckets: per client IP (wide, catches fan-out) and per
// username+IP (tight, catches targeted guessing). 5-minute window.
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_IP_LIMIT = 12;
const RL_USER_LIMIT = 5;

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = (await req.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Enter your username and password to continue." },
      { status: 400 },
    );
  }

  // Bruteforce gate — counted before the TrailBase call so failed attempts
  // are the expensive thing being limited. Successful logins also count
  // toward the (generous) IP bucket; the per-user bucket only throttles
  // repeated failures in practice because 5 successes in 5 minutes from one
  // IP is normal for a shared machine.
  const ip = clientIp(req);
  if (!rateLimit(`login:ip:${ip}`, RL_IP_LIMIT, RL_WINDOW_MS)) {
    writeAudit({ action: "login.rate_limited", entity: "auth", payload: { ip, username: username.slice(0, 64) } }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts from this connection. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }
  if (!rateLimit(`login:user:${username}:${ip}`, RL_USER_LIMIT, RL_WINDOW_MS)) {
    writeAudit({ action: "login.rate_limited_user", entity: "auth", payload: { ip, username: username.slice(0, 64) } }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts for this account. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }

  // ── 1. TrailBase login (server-side) ─────────────────────────────────
  let tbStatus = 0;
  let tbData: Record<string, unknown> = {};
  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });
    tbStatus = res.status;
    tbData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reach the sign-in service. Please try again." },
      { status: 502 },
    );
  }

  const token = typeof tbData.auth_token === "string" ? tbData.auth_token : null;
  const mfaChallenge = typeof tbData.mfa_token === "string" ? tbData.mfa_token : null;

  if (!((tbStatus === 403 || tbStatus === 200) && (token || mfaChallenge))) {
    return NextResponse.json({ ok: false, error: "Incorrect username or password." }, { status: 401 });
  }

  // ── 2. suspension gate (trust, fail-open) ────────────────────────────
  const status = await trustStatus(username);
  if (status.suspended) {
    if (token) {
      // invalidate the just-issued session — suspended users get nothing
      void fetch(`${TRAILBASE}/api/auth/v1/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    }
    await writeAudit({
      user: userB64For(username),
      action: "account:signin_blocked",
      entity: "auth",
      source: "web",
      payload: { username, ip: clientIp(req), ua: clientUa(req), reason: status.reason ?? "suspended" },
    });
    return NextResponse.json(
      {
        ok: false,
        suspended: true,
        appeal: true,
        error:
          "This account is suspended. " +
          (status.reason ? `Reason: ${status.reason}. ` : "") +
          "Request a review from Support (Help & SLA → Contact support).",
      },
      { status: 403 },
    );
  }

  // ── 3a. TrailBase-native MFA challenge → code step ───────────────────
  if (mfaChallenge) {
    return NextResponse.json({ ok: true, mfa_required: true, mfa_token: mfaChallenge, username });
  }

  // ── 3b. trust-owned MFA policy (mfa_active, no TrailBase challenge) ──
  if (status.available && status.mfa_active) {
    const pendingId = putPendingTrustMfa(username, token!);
    return NextResponse.json({ ok: true, mfa_required: true, trust_pending: pendingId, username });
  }

  // ── 4. all gates passed — issue the session ──────────────────────────
  return NextResponse.json({ ok: true, token, username });
}
