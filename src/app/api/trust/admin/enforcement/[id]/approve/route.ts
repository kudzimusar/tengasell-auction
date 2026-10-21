// POST /api/trust/admin/enforcement/[id]/approve — second-admin approval for
// pending dual-approval rows (CTL-021). The service REJECTS the same admin
// who requested the action (403 same_admin).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return adminTrustProxy(req, `/admin/enforcement/${encodeURIComponent(id)}/approve`, {
    body: body && typeof body === "object" ? body : {},
  });
}
