// POST /api/gov/admin/privacy-requests/[id]/[action] — DSAR handling.
//   action ∈ verify | process | complete | reject
//     verify   received → verifying          (body: {note?})
//     process  verifying → in_progress        (access/portability builds the
//              export bundle; deletion REFUSES while a legal hold is active;
//              restriction/objection set processing flags; body: {note?})
//     complete in_progress → completed       (deletion lists retention
//              exceptions; body: {note?})
//     reject   any active → rejected          (body: {note} REQUIRED).

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["verify", "process", "complete", "reject"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return govJson({ ok: false, error: "Unknown privacy-request action." }, 404);
  }
  const body = await req.json().catch(() => ({}));
  return adminGovProxy(req, `/admin/privacy-requests/${encodeURIComponent(id)}/${action}`, {
    body,
  });
}
