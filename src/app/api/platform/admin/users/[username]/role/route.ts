// POST /api/platform/admin/users/[username]/role — role assignment (CTL-003).
//
// Delegated to the trust-service roles API (owner 12-c):
// POST /internal/roles {username, role, actor}. Fails closed with an honest
// provisioning state while trust is down. Body: {role, reason?}.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, maintenanceBlocked, requireAdmin, trustPost, userB64For, writeAudit } from "@/lib/server/platform";

const KNOWN_ROLES = ["user", "support", "moderator", "finance", "compliance"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const maintenance = maintenanceBlocked();
  if (maintenance) return maintenance;

  const { username } = await params;
  const uname = decodeURIComponent(username).toLowerCase();

  let body: { role?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const role = String(body.role ?? "");
  const reason = String(body.reason ?? "").trim();
  if (!KNOWN_ROLES.includes(role)) {
    return NextResponse.json(
      { ok: false, error: `Role must be one of: ${KNOWN_ROLES.join(", ")}.` },
      { status: 400 },
    );
  }
  if (reason.length < 3) {
    return NextResponse.json({ ok: false, error: "A reason is required (audited)." }, { status: 400 });
  }

  const res = await trustPost("/internal/roles", { username: uname, role, actor: gate.username }, 3000);
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          res.status === 0
            ? "Trust service is provisioning (12-c build) — role assignment is unavailable right now."
            : `Trust service rejected the request (${res.status}).`,
        provisioning: res.status === 0,
      },
      { status: 503 },
    );
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:role_assigned",
    entity: "users",
    source: "admin",
    payload: { target: uname, role, reason, actor: gate.username },
  });

  return NextResponse.json({ ok: true, username: uname, role });
}
