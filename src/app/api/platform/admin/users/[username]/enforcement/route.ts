// POST /api/platform/admin/users/[username]/enforcement — suspend/restore
// (CTL-003/008, EXP suspension gate authority = trust-service).
//
// Body: {action: "suspend" | "restore", reason: REQUIRED, days?: number}.
// Delegated to trust's ADMIN API POST :3007/admin/enforcement with the
// master-contract §F headers (x-tgs-user + x-tgs-admin — the BFF has already
// verified the TrailBase token + admin claim). Trust's own CTL-021 semantics
// apply and are surfaced honestly:
//   · suspend days 1..7  → applies IMMEDIATELY (ladder step, single admin)
//   · suspend open-ended (>7 or none) → returns {pending:true} — a SECOND
//     admin must approve in the Trust console before it takes effect
//   · restore → immediate reinstate
// While trust is down this route fails CLOSED for the mutation (503 with an
// honest "service provisioning" state) — unlike the sign-in gate (fail-open
// for availability), enforcement must never be silently faked. Audit row
// always written (platform:enforcement_attempted / platform:enforcement).

import { NextRequest, NextResponse } from "next/server";
import {
  clientIp,
  isResponse,
  maintenanceBlocked,
  requireAdmin,
  svcFetch,
  PORTS,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const maintenance = maintenanceBlocked();
  if (maintenance) return maintenance;

  const { username } = await params;
  const uname = decodeURIComponent(username).toLowerCase();

  let body: { action?: string; reason?: string; days?: number | null; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const reason = String(body.reason ?? "").trim();
  const note = String(body.note ?? "").trim();
  const days =
    body.days == null || body.days === 0 ? null : Math.min(Math.max(Number(body.days), 1), 365);
  if (action !== "suspend" && action !== "restore") {
    return NextResponse.json({ ok: false, error: "Action must be suspend or restore." }, { status: 400 });
  }
  if (reason.length < 3) {
    return NextResponse.json(
      { ok: false, error: "A reason is required for every enforcement action (audited)." },
      { status: 400 },
    );
  }
  if (uname === "admin") {
    return NextResponse.json(
      { ok: false, error: "The break-glass admin account cannot be suspended from the console." },
      { status: 400 },
    );
  }

  const res = await svcFetch(
    PORTS.trust,
    "/admin/enforcement",
    {
      method: "POST",
      timeoutMs: 3000,
      headers: {
        "x-tgs-user": gate.username,
        "x-tgs-admin": "1",
      },
      body: JSON.stringify({
        username: uname,
        action: action === "suspend" ? "suspension" : "reinstate",
        reason_code: reason,
        note: note || `Requested via Platform users console by ${gate.username}.`,
        days,
      }),
    },
  );
  if (!res.ok) {
    await writeAudit({
      user: userB64For(gate.username),
      action: "platform:enforcement_unavailable",
      entity: "users",
      source: "admin",
      payload: { target: uname, action, reason, trust_status: res.status },
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          res.status === 0
            ? "Trust service is provisioning (12-c build) — enforcement is unavailable right now. This mutation fails closed by design."
            : `Trust service rejected the request (${res.status}).`,
        provisioning: res.status === 0,
      },
      { status: 503 },
    );
  }

  const pending = res.data?.pending === true;
  await writeAudit({
    user: userB64For(gate.username),
    action: pending
      ? "platform:enforcement_pending"
      : action === "suspend"
        ? "platform:user_suspended"
        : "platform:user_restored",
    entity: "users",
    source: "admin",
    payload: { target: uname, reason, days, pending, actor: gate.username, ip: clientIp(req) },
  });

  return NextResponse.json({ ok: true, action, username: uname, pending, days });
}
