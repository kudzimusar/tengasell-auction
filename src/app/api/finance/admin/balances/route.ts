// GET /api/finance/admin/balances → GET :3006/admin/balances
// Cached seller balances + the platform-level account positions.

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/balances");
}
