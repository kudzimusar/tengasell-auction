// GET /api/platform/admin/stepup — step-up gate status for the platform
// consoles (IAM-010). Admin-only.
//
// {required} is true when the admin has MFA active AND the signed
// ts_tgs_admin_mfa cookie is missing/expired (>30 min old). Admins WITHOUT
// MFA get {required:false, mfa_active:false} plus an enrollment nudge —
// the gate activates the moment MFA is on (the consoles surface this
// honestly instead of silently waiving the control).

import { NextRequest, NextResponse } from "next/server";
import {
  isResponse,
  readStepupToken,
  requireAdmin,
  STEPUP_COOKIE,
  totpSecretFor,
} from "@/lib/server/platform";

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const secret = totpSecretFor(gate.username);
  const mfaActive = !!secret;
  const cookie = req.cookies.get(STEPUP_COOKIE)?.value;
  const verified = await readStepupToken(cookie);
  const fresh = verified && verified.username === gate.username;

  return NextResponse.json({
    ok: true,
    username: gate.username,
    mfa_active: mfaActive,
    required: mfaActive && !fresh,
    last_verified_at: fresh ? new Date(verified!.exp * 1000).toISOString() : null,
  });
}
