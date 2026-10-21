// POST /api/platform/admin/flags — feature-flag write (CTL-015/022).
//
// Admin-only mutation with a REQUIRED human reason (audited). Uses
// platform.ts writeFlag (db/flags.json, last-changed trail). maintenance_mode
// freezes privileged platform mutations via maintenanceBlocked() in the
// suspend/takedown/relist/cancel/role/enforcement routes — that is the
// implemented v1 enforcement scope, documented honestly in the console.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, readFlags, requireAdmin, userB64For, writeAudit, writeFlag } from "@/lib/server/platform";

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;
  return NextResponse.json({ ok: true, flags: readFlags() });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  let body: { key?: string; value?: boolean; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const key = String(body.key ?? "");
  const value = body.value === true;
  const reason = String(body.reason ?? "").trim();
  if (!key) return NextResponse.json({ ok: false, error: "key is required." }, { status: 400 });
  if (reason.length < 3) {
    return NextResponse.json(
      { ok: false, error: "A reason is required for every flag change (audited)." },
      { status: 400 },
    );
  }

  const before = readFlags().find((f) => f.key === key) ?? null;
  const updated = writeFlag(key, value, gate.username, reason);
  if (!updated) {
    return NextResponse.json({ ok: false, error: `Unknown flag: ${key}.` }, { status: 404 });
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:flag_changed",
    entity: "flags",
    source: "admin",
    payload: { key, from: before?.value ?? null, to: value, reason, actor: gate.username },
  });

  return NextResponse.json({ ok: true, flag: updated });
}
