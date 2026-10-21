// POST /api/trust/admin/cases/[id]/resolve → {outcome} (required) — resolves
// the case, stamps the ticket event and notifies the involved user (CTL-012).

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
  return adminTrustProxy(req, `/admin/cases/${encodeURIComponent(id)}/resolve`, { body });
}
