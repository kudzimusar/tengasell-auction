// POST /api/auth/security/mfa/start — TOTP enrollment, step 1 (IAM-004).
//
// Acts AS THE USER (their own token) against TrailBase's native
// GET /api/auth/v1/totp/register → {totp_url, png}. QR-less UX: the response
// carries the otpauth:// URI and the extracted base32 secret for manual
// authenticator entry (Google Authenticator / Aegis / 1OTP all accept
// manual entry). No secret is persisted by this route — TrailBase only
// stores it AFTER /mfa/confirm validates a live code.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireUser } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/totp/register`, {
      headers: { Authorization: `Bearer ${gate.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "TOTP enrollment could not start (you may already have MFA on)." },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { totp_url?: string };
    const totpUrl = typeof data.totp_url === "string" ? data.totp_url : "";
    const m = totpUrl.match(/secret=([A-Z2-7]+)/i);
    return NextResponse.json({
      ok: true,
      totp_url: totpUrl,
      secret: m ? m[1] : null,
      note: "Add the secret to your authenticator app (manual entry), then enter the 6-digit code it shows.",
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the sign-in service." }, { status: 502 });
  }
}
