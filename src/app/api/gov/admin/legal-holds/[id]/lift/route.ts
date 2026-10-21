// POST /api/gov/admin/legal-holds/[id]/lift — lift a legal hold (releases
// the DSAR deletion block).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return adminGovProxy(req, `/admin/legal-holds/${encodeURIComponent(id)}/lift`, {
    body: {},
  });
}
