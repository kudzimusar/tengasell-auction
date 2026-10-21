// POST /api/auth/admin/stepup — privileged-access step-up (IAM-010).
//
// Admins with MFA active must re-verify a FRESH TOTP code to use the
// platform consoles when the last verification is older than 30 minutes.
// Verification: the BFF recomputes RFC-6238 codes from TrailBase's
// _user.totp_secret (server-side read; never leaves the server) with a ±30s
// window — it does NOT disable anything. Success issues a signed cookie
// (jose HS256, ts_tgs_admin_mfa, 30 min, httpOnly) that
// /api/platform/admin/stepup checks. Secret: PLATFORM_JWT_SECRET env with a
// documented dev fallback (rotate in production — runbooks.md).

import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  issueStepupToken,
  isResponse,
  requireAdmin,
  STEPUP_COOKIE,
  STEPUP_MAX_AGE_SEC,
  totpSecretFor,
  userB64For,
  verifyTotp,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  let body: { code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  const secret = totpSecretFor(gate.username);
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "MFA is not enabled for this admin — enable it in My Tengasell → Security first.",
        needs_enrollment: true,
      },
      { status: 400 },
    );
  }
  if (!/^\d{6}$/.test(code) || !verifyTotp(secret, code)) {
    await writeAudit({
      user: userB64For(gate.username),
      action: "platform:stepup_failed",
      entity: "auth",
      source: "admin",
      payload: { username: gate.username, ip: clientIp(req) },
    });
    return NextResponse.json({ ok: false, error: "That code isn't right. Try the current code." }, { status: 401 });
  }

  const token = await issueStepupToken(gate.username);
  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:stepup_verified",
    entity: "auth",
    source: "admin",
    payload: { username: gate.username, ip: clientIp(req) },
  });

  const res = NextResponse.json({ ok: true, verified_until: new Date(Date.now() + STEPUP_MAX_AGE_SEC * 1000).toISOString() });
  res.cookies.set(STEPUP_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: STEPUP_MAX_AGE_SEC,
  });
  return res;
}
