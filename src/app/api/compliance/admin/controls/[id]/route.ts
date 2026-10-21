// PATCH /api/compliance/admin/controls/[id] — update a control's status /
// evidence note (the 12-f tick-every-box surface; every change records
// updated_by). Body: {status?: S00..S90, evidence_note?}.

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, `/admin/controls/${encodeURIComponent(id)}`, {
    body,
    methodOverride: "PATCH",
  });
}
