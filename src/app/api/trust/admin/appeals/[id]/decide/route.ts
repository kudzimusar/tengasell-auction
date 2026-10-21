// POST /api/trust/admin/appeals/[id]/decide → {decision: under_review|granted|
// denied, decision_note?} — granted auto-applies reinstatement (TNS-013).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return adminTrustProxy(req, `/admin/appeals/${encodeURIComponent(id)}/decide`, { body });
}
