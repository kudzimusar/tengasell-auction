// GET /api/auth/status — session + security status mirror for the client.
//
// Bearer session → {username, admin, mfa_active (TrailBase-native claim),
// suspension (trust, fail-open), trust_available}. Used by the sign-in
// flow's post-gate checks and any surface that needs the honest
// provisioning state of the trust-service.

import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, isResponse, requireUser, trustStatus } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  let mfaActive = false;
  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${gate.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { auth_token?: string };
      mfaActive = decodeJwt(data.auth_token ?? gate.token).mfa === true;
    }
  } catch {
    /* degrade */
  }

  const status = await trustStatus(gate.username);
  return NextResponse.json({
    ok: true,
    username: gate.username,
    admin: gate.admin,
    mfa_active: mfaActive,
    suspension: status.available && status.suspended ? { reason: status.reason ?? null } : null,
    trust_available: status.available,
  });
}
