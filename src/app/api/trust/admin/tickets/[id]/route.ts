// GET /api/trust/admin/tickets/[id] → ticket detail: full message thread
// (including INTERNAL notes) + the event log. Admin-only.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminTrustProxy(req, `/admin/tickets/${encodeURIComponent(id)}`);
}
