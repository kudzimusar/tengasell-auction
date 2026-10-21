// GET  /api/finance/admin/chargebacks → GET  :3006/admin/chargebacks
// POST /api/finance/admin/chargebacks → POST :3006/admin/chargebacks
//   body: { orderId (REQUIRED), amountCents|amount (REQUIRED), providerRef?, evidence? }

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/chargebacks");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/chargebacks", { body });
}
