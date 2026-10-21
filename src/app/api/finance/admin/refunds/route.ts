// GET  /api/finance/admin/refunds → GET  :3006/admin/refunds (queue + credit notes)
// POST /api/finance/admin/refunds → POST :3006/admin/refunds
//   body: { orderId (REQUIRED), kind:"full"|"partial", amountCents? (partial),
//           reasonCode (REQUIRED), reasonNote? }
//   Refunds ≤ refund_auto_max and under the dual threshold auto-process.

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/refunds");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/refunds", { body });
}
