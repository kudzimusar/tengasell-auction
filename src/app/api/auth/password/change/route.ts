// POST /api/auth/password/change — signed-in password change (IAM-003/016).
//
// Self-service: forwarded to TrailBase /api/auth/v1/change_password WITH the
// caller's own token (old password proves possession). Completing a change
// also completes the credential-revocation path (logout + re-sign-in is
// enforced naturally by the client after success).

import { NextRequest, NextResponse } from "next/server";
import { clientIp, isResponse, requireUser, userB64For, writeAudit } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  let body: { old_password?: string; new_password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const oldPassword = String(body.old_password ?? "");
  const newPassword = String(body.new_password ?? "");
  if (!oldPassword || newPassword.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Enter your current password and a new password of at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/change_password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gate.token}` },
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
        new_password_repeat: newPassword,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, error: "Your current password isn't right." }, { status: 401 });
      }
      if (/len|min|8/i.test(text)) {
        return NextResponse.json(
          { ok: false, error: "New passwords must be at least 8 characters." },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: false, error: "Password change failed. Please try again." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the sign-in service." }, { status: 502 });
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "account:password_changed",
    entity: "auth",
    source: "web",
    payload: { username: gate.username, ip: clientIp(req), via: "self-service" },
  });

  return NextResponse.json({ ok: true });
}
