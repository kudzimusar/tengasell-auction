// POST /api/auth/mfa/verify — complete the MFA-gated sign-in (IAM-004).
//
// Two verification authorities, in order:
//   · TrailBase-native: {mfa_token (challenge), code} → TrailBase
//     /api/auth/v1/login_mfa — the auth_token is ONLY issued by TrailBase
//     when the TOTP code matches (real gate at the token authority).
//   · trust-owned: {trust_pending (id), code} → trust /mfa/verify; the
//     held TrailBase token is released when trust says valid.
// Success records the sign-in activity via /api/platform/session (client,
// fire-and-forget) — this route only verifies.

import { NextRequest, NextResponse } from "next/server";
import { clearPendingTrustMfa, takePendingTrustMfa, trustPost } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  let body: { mfa_token?: string; trust_pending?: string; code?: string };
  try {
    body = (await req.json()) as { mfa_token?: string; trust_pending?: string; code?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });
  }

  // ── path A: TrailBase-native challenge token ──────────────────────────
  if (body.mfa_token) {
    try {
      const res = await fetch(`${TRAILBASE}/api/auth/v1/login_mfa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfa_token: body.mfa_token, totp: code }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: "That code isn't right (or expired). Try the current code from your app." },
          { status: 401 },
        );
      }
      const data = (await res.json()) as { auth_token?: string };
      if (!data.auth_token) {
        return NextResponse.json({ ok: false, error: "Sign-in could not be completed. Try again." }, { status: 502 });
      }
      return NextResponse.json({ ok: true, token: data.auth_token });
    } catch {
      return NextResponse.json(
        { ok: false, error: "Could not reach the sign-in service. Please try again." },
        { status: 502 },
      );
    }
  }

  // ── path B: trust-owned MFA pending session ───────────────────────────
  if (body.trust_pending) {
    const pending = takePendingTrustMfa(body.trust_pending);
    if (!pending) {
      return NextResponse.json(
        { ok: false, error: "This verification expired — sign in again." },
        { status: 401 },
      );
    }
    const res = await trustPost("/internal/mfa/verify", { username: pending.username, code });
    if (!res.ok || res.data?.valid !== true) {
      return NextResponse.json({ ok: false, error: "That code isn't right. Try again." }, { status: 401 });
    }
    clearPendingTrustMfa(body.trust_pending);
    return NextResponse.json({ ok: true, token: pending.token });
  }

  return NextResponse.json({ ok: false, error: "Nothing to verify — start sign-in again." }, { status: 400 });
}
