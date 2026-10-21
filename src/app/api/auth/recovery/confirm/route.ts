// POST /api/auth/recovery/confirm — account recovery, step 2 (IAM-007/016).
//
// 1. Validate the 6-digit code against the SAME authority that issued it:
//    trust /internal/recovery/confirm when trust started the recovery,
//    otherwise the BFF's hashed pending session (fail-over documented).
// 2. Set the new password via the admin-assisted path (TrailBase v0.35 has
//    no admin password-set API and no email delivery in this sandbox):
//    "hash transplant" — TrailBase itself hashes the new password through a
//    throwaway registration, the argon2id encoded hash is copied into the
//    target _user row and the throwaway is deleted (lib/server/platform.ts).
// Audit: account:password_reset. Revocation note: existing JWTs live to
// their natural expiry (24h TTL); the runbook documents forced rotation.

import { NextRequest, NextResponse } from "next/server";
import {
  adminSetPassword,
  checkPendingRecovery,
  clientIp,
  findUserByUsername,
  recoveryPendingFor,
  trustPost,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  let body: { username?: string; code?: string; new_password?: string; new_password_repeat?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const username = String(body.username ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const newPassword = String(body.new_password ?? "");
  const repeat = String(body.new_password_repeat ?? newPassword);
  if (!username || !code) {
    return NextResponse.json({ ok: false, error: "Enter the code we sent you." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "New passwords must be at least 8 characters." }, { status: 400 });
  }
  if (newPassword !== repeat) {
    return NextResponse.json({ ok: false, error: "The new passwords don't match." }, { status: 400 });
  }
  const user = findUserByUsername(username);
  if (!user) {
    return NextResponse.json({ ok: false, error: "That code isn't right. Start the recovery again." }, { status: 401 });
  }

  // ── 1. validate the code (issuer-first) ────────────────────────────────
  let valid = false;
  if (recoveryPendingFor(username)) {
    const check = checkPendingRecovery(username, code);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 401 });
    valid = true;
  } else {
    // trust-issued recovery — validate against trust (the authority)
    const res = await trustPost("/internal/recovery/confirm", { username, code });
    if (res.ok && res.data?.valid === true) valid = true;
    else
      return NextResponse.json(
        { ok: false, error: "That code isn't right or has expired. Start the recovery again." },
        { status: 401 },
      );
  }
  if (!valid) {
    return NextResponse.json({ ok: false, error: "That code isn't right. Try again." }, { status: 401 });
  }

  // ── 2. set the new password (admin-assisted hash transplant) ───────────
  const set = await adminSetPassword(username, newPassword);
  if (!set.ok) {
    return NextResponse.json({ ok: false, error: set.error ?? "Password update failed." }, { status: 500 });
  }

  await writeAudit({
    user: userB64For(username),
    action: "account:password_reset",
    entity: "auth",
    source: "web",
    payload: { username, ip: clientIp(req), via: "recovery" },
  });

  return NextResponse.json({ ok: true });
}
