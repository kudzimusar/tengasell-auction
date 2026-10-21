// GET /api/finance/me/receipt/[orderId] → GET :3006/me/receipt/:orderId
// Buyer receipt (COM-020) + finance breakdown; scoped to buyer/seller/admin
// by the service via the forwarded x-tgs-user / x-tgs-admin headers.

import type { NextRequest } from "next/server";
import { financeJson, financeProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) {
    return financeJson({ ok: false, error: "Unknown order." }, 400);
  }
  return financeProxy(req, `/me/receipt/${id}`);
}
