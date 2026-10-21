// POST /api/trust/admin/reports/[id]/[action] — action ∈ review | action | dismiss
//   review  → opens a case with an immutable evidence snapshot (TNS-002)
//   action  → {outcome, takedown?} — takedown ends a LISTING auction + notifies
//   dismiss → {outcome?} — not substantiated

import type { NextRequest } from "next/server";
import { adminTrustProxy, trustJson } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["review", "action", "dismiss"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return trustJson({ ok: false, error: "Unknown report action." }, 404);
  }
  const body = await req.json().catch(() => ({}));
  if (body === null || typeof body !== "object") {
    return trustJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminTrustProxy(req, `/admin/reports/${encodeURIComponent(id)}/${action}`, { body });
}
