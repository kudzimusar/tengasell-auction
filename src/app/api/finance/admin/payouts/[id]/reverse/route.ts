// POST /api/finance/admin/payouts/[id]/reverse → POST :3006/admin/payouts/:id/reverse
// body: { reason (REQUIRED) } — rejected (from requested), un-earmarked
// (from approved) or funds returned to the seller (from paid, COM-018).

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const payoutId = Number(id);
  if (!Number.isInteger(payoutId) || payoutId <= 0) {
    return financeJson({ ok: false, error: "Unknown payout." }, 400);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, `/admin/payouts/${payoutId}/reverse`, { body });
}
