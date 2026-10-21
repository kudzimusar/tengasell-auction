// GET  /api/finance/admin/payouts → GET  :3006/admin/payouts?status=
// POST /api/finance/admin/payouts → POST :3006/admin/payouts
//   body: { username, amountCents|amount, method, destination, idNumber }
//   (admin-created payout on behalf of a seller — ops/testing path).

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const search = new URL(req.url).search;
  return adminFinanceProxy(req, "/admin/payouts" + search);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/payouts", { body });
}
