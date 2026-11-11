// GET /api/auth/status — session + security status mirror for the client.
//
// Bearer session → {username, admin, mfa_active (TrailBase-native claim),
// suspension (trust, fail-open), trust_available}. Used by the sign-in
// flow's post-gate checks and any surface that needs the honest
// provisioning state of the trust-service.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireUser, trustStatus } from "@/lib/server/platform";

export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  const status = await trustStatus(gate.username);
  return NextResponse.json({
    ok: true,
    username: gate.username,
    admin: gate.admin,
    mfa_active: gate.mfa === true,
    suspension: status.available && status.suspended ? { reason: status.reason ?? null } : null,
    trust_available: status.available,
  });
}
