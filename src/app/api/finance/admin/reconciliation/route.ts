// GET /api/finance/admin/reconciliation → GET :3006/admin/reconciliation
// Last recon run (payments checked / matched / exceptions) + bank lines.

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/reconciliation");
}
