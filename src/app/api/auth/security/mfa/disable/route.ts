// POST /api/auth/security/mfa/disable — turn TOTP MFA off (IAM-004).
//
// Requires a LIVE 6-digit code (TrailBase /totp/unregister with the user's
// token — a stolen signed-in session cannot silently remove MFA without
// the authenticator). Recovery-code custody is purged on success.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, purgeRecoveryCodes, requireUser, userB64For, writeAudit } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  let body: { code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ ok: false, error: "Enter the current 6-digit code to turn MFA off." }, { status: 400 });
  }

  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/totp/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gate.token}` },
      body: JSON.stringify({ totp: code }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "That code isn't right — MFA stays on. Try the current code." },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the sign-in service." }, { status: 502 });
  }

  purgeRecoveryCodes(gate.username);
  await writeAudit({
    user: userB64For(gate.username),
    action: "account:mfa_disabled",
    entity: "auth",
    source: "web",
    payload: { username: gate.username },
  });

  return NextResponse.json({ ok: true });
}
