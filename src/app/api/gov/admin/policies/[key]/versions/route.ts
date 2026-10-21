// GET /api/gov/admin/policies/[key]/versions — version history + audit trail.

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return adminGovProxy(req, `/admin/policies/${encodeURIComponent(key)}/versions`);
}
