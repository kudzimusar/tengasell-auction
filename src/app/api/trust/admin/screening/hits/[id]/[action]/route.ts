// POST /api/trust/admin/screening/hits/[id]/[action] — action ∈ clear | action
//   clear  → false positive, dismissed (audit-logged)
//   action → TAKEDOWN: ends the auction + notifies buyers/watchers/seller

import type { NextRequest } from "next/server";
import { adminTrustProxy, trustJson } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["clear", "action"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return trustJson({ ok: false, error: "Unknown screening action." }, 404);
  }
  const body = await req.json().catch(() => ({}));
  return adminTrustProxy(req, `/admin/screening/hits/${encodeURIComponent(id)}/${action}`, {
    body: body && typeof body === "object" ? body : {},
  });
}
