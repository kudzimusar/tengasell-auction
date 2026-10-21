// GET  /api/finance/admin/config → GET  :3006/admin/config (money rules)
// POST /api/finance/admin/config → POST :3006/admin/config
//   body: any of { fee_pct, fee_cap, featured_fee, vat_pct, payout_min,
//                  dual_approval_threshold, escrow_days, currency, refund_auto_max }

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/config");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/config", { body });
}
