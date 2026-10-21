// POST /api/finance/admin/reconciliation/run → POST :3006/admin/reconciliation/run
// Ties settled TrailBase payments + order statuses against the finance
// ledger and records a recon_runs row (COM-024 tie-out).

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/reconciliation/run");
}
