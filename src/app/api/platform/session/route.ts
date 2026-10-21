// POST /api/platform/session — record sign-in activity (IAM-017).
//
// Called by the client immediately after a successful (MFA-gated) sign-in:
//   · audit_events row (action account:signin, payload {ip, ua, result})
//     — this is what the Security section's "recent sign-in activity" list
//     reads back via /api/auth/security/state
//   · mirror to trust /internal/signin (fire-and-forget; trust is the
//     intended session-inventory authority — the audit row is the working
//     v1 record while trust provisions)

import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  clientUa,
  isResponse,
  requireUser,
  trustRecordSignin,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (isResponse(gate)) return gate;

  const ip = clientIp(req);
  const ua = clientUa(req);

  await writeAudit({
    user: userB64For(gate.username),
    action: "account:signin",
    entity: "auth",
    source: "web",
    payload: { username: gate.username, ip, ua, result: "ok" },
  });
  trustRecordSignin({ username: gate.username, ip, ua, result: "ok" });

  return NextResponse.json({ ok: true });
}
