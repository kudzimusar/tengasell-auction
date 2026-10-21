// POST /api/trust/admin/tickets/[id]/[action] — action ∈ assign | reply | status
//   assign → {assignee}                       (SUP-003/004)
//   reply   → {body, internal?}               (internal notes never reach the customer)
//   status  → {status, resolution_note?}      (open|pending|resolved|closed)

import type { NextRequest } from "next/server";
import { adminTrustProxy, trustJson } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["assign", "reply", "status"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return trustJson({ ok: false, error: "Unknown ticket action." }, 404);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return trustJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminTrustProxy(req, `/admin/tickets/${encodeURIComponent(id)}/${action}`, { body });
}
