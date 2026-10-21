// POST /api/platform/admin/alert — "Send test alert" (OPS-009).
//
// Emits an admin test notification through comms-service POST /events using
// the DOCUMENTED transactional event key "account.security" (Security alert
// — the comms intake rejects unknown event keys, and the master contract §F
// allows template-catalogue additions only by coordination; v1 reuses the
// existing security template with a clearly-marked test note). Delivery:
// the requesting admin's own verified channels — in mock-provider mode the
// message lands in the comms mock inbox (Comms console → Mock viewers).
// Honors the alerts_enabled flag (Config console) — a disabled alerting
// channel is surfaced, not silently bypassed. Audit-logged.

import { NextRequest, NextResponse } from "next/server";
import {
  COMMS_BASE,
  flagValue,
  isResponse,
  requireAdmin,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  if (!flagValue("alerts_enabled")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Alerts are switched off (alerts_enabled flag) — turn them on in Configuration to send test alerts.",
        alerts_disabled: true,
      },
      { status: 503 },
    );
  }

  const note =
    "TEST ALERT from the Tengasell platform health panel — this is a delivery check of the operational alerting channel. No action needed.";
  let queued = 0;
  let channels: string[] = [];
  let commsDown = false;
  try {
    const res = await fetch(`${COMMS_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: gate.username,
        eventKey: "account.security",
        params: { securityNote: note, location: "platform health console" },
        deepLink: "/#/admin/health",
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { queued?: number; channels?: string[] };
      queued = Number(data.queued ?? 0);
      channels = Array.isArray(data.channels) ? data.channels : [];
    } else {
      commsDown = true;
    }
  } catch {
    commsDown = true;
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:test_alert",
    entity: "platform",
    source: "admin",
    payload: { actor: gate.username, queued, channels, comms_down: commsDown },
  });

  if (commsDown) {
    return NextResponse.json(
      { ok: false, error: "Comms service unreachable — the alert could not be queued." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    queued,
    channels,
    note:
      queued > 0
        ? `Test alert queued to @${gate.username} on ${channels.join(", ") || "no channels"}.`
        : `Comms accepted the event but queued 0 — @${gate.username} has no verified channel with notifications on. Link one in My Tengasell → Communications.`,
  });
}
