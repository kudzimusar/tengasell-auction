// GET /api/finance/admin/stats → GET :3006/admin/stats
// Finance KPIs: escrow holding, 30d revenue, VAT due, payouts pending,
// refunds 30d, bank position, seller owed (EXE-002/FIN-019).

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/stats");
}
