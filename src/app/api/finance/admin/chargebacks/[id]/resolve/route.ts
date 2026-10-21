// POST /api/finance/admin/chargebacks/[id]/resolve → POST :3006/admin/chargebacks/:id/resolve
// body: { resolution:"seller_liability"|"platform_absorbed" (REQUIRED), note? }
// Posts the balanced clawback/absorption transaction and resolves the case.

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const cbId = Number(id);
  if (!Number.isInteger(cbId) || cbId <= 0) {
    return financeJson({ ok: false, error: "Unknown chargeback." }, 400);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, `/admin/chargebacks/${cbId}/resolve`, { body });
}
