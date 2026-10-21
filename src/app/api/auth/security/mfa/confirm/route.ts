// POST /api/auth/security/mfa/confirm — TOTP enrollment, step 2 (IAM-004).
//
// Confirms the pending secret with a live 6-digit code (TrailBase
// /totp/confirm, user token) — only now does TrailBase store the secret and
// START ENFORCING MFA at login. On success the BFF generates 8 one-time
// recovery codes: sha256-hashed at rest (db/mfa-recovery.json + mirrored to
// trust when up) and returned IN CLEAR exactly once — the UI must treat
// this response as the only display opportunity.

import { NextRequest, NextResponse } from "next/server";
import {
  generateRecoveryCodes,
  isResponse,
  requireUser,
  storeRecoveryCodes,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  let body: { totp_url?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const totpUrl = String(body.totp_url ?? "");
  const code = String(body.code ?? "").trim();
  if (!totpUrl || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });
  }

  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/totp/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gate.token}` },
      body: JSON.stringify({ totp_url: totpUrl, totp: code }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "That code didn't match. Check the secret in your app and try the current code." },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the sign-in service." }, { status: 502 });
  }

  const codes = generateRecoveryCodes(8);
  storeRecoveryCodes(gate.username, codes);

  await writeAudit({
    user: userB64For(gate.username),
    action: "account:mfa_enabled",
    entity: "auth",
    source: "web",
    payload: { username: gate.username },
  });

  return NextResponse.json({ ok: true, recovery_codes: codes });
}
