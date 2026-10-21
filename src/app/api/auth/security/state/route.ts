// GET /api/auth/security/state — the Security section's data bundle.
//
// Returns for the signed-in caller:
//   · mfa_active       — TrailBase-native TOTP (mfa claim on the verified
//                        JWT + _user.totp_secret presence as a cross-check)
//   · has_recovery_codes — hashed recovery codes on file (shown ONCE only)
//   · suspension       — trust status (fail-open: null while provisioning)
//   · trust_available  — honest "service provisioning" state for the UI
//   · roles            — staff roles from the trust authority (12-c RBAC)
//   · recent_signins   — last 8 account:signin audit rows for this user

import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, hasRecoveryCodes, isResponse, requireUser, trustStatus } from "@/lib/server/platform";
import { tbList } from "@/lib/server/trailbase-admin";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

interface SigninRow {
  at: string;
  ip: string;
  ua: string;
  result: string;
}

export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  // mfa claim straight from TrailBase's own status token (server-side verify)
  let mfaActive = false;
  try {
    const res = await fetch(`${TRAILBASE}/api/auth/v1/status`, {
      headers: { Authorization: `Bearer ${gate.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { auth_token?: string };
      const active = data.auth_token ?? gate.token;
      mfaActive = decodeJwt(active).mfa === true;
    }
  } catch {
    /* status unreachable — leave false, UI degrades */
  }

  const status = await trustStatus(gate.username);

  // recent sign-in activity: audit rows written by /api/platform/session
  let recent: SigninRow[] = [];
  try {
    const rows = await tbList("audit_events", {
      "filter[action][$eq]": "account:signin",
      order: "-id",
      limit: 200,
    });
    recent = rows
      .map((r) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(r.payload ?? "{}")) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        return {
          at: String(r.created_at ?? ""),
          ip: String(payload.ip ?? ""),
          ua: String(payload.ua ?? ""),
          result: String(payload.result ?? "ok"),
          username: String(payload.username ?? ""),
        };
      })
      .filter((r) => r.username === gate.username)
      .slice(0, 8)
      .map((r) => ({ at: r.at, ip: r.ip, ua: r.ua, result: r.result }));
  } catch {
    /* audit read failed — leave empty */
  }

  return NextResponse.json({
    ok: true,
    username: gate.username,
    mfa_active: mfaActive,
    has_recovery_codes: hasRecoveryCodes(gate.username),
    suspension: status.available
      ? { suspended: status.suspended, reason: status.reason ?? null, at: status.suspendedAt ?? null }
      : null,
    trust_available: status.available,
    roles: status.roles,
    recent_signins: recent,
  });
}
