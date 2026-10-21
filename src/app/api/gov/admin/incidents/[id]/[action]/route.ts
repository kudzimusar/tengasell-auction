// POST /api/gov/admin/incidents/[id]/[action] — incident handling.
//   action ∈ timeline | close
//     timeline → append {event} to the incident timeline
//     close    → close with {rca} REQUIRED + {corrective_actions: [string|
//                {what, owner?, due?, status?}], reported_at?}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["timeline", "close"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return govJson({ ok: false, error: "Unknown incident action." }, 404);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, `/admin/incidents/${encodeURIComponent(id)}/${action}`, {
    body,
  });
}
