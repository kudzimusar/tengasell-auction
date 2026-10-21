// POST /api/finance/admin/bank-lines/[id]/match → POST :3006/admin/bank-lines/:id/match
// body: { ref (REQUIRED — a payment or payout reference), refType:"payment"|"payout" }

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const lineId = Number(id);
  if (!Number.isInteger(lineId) || lineId <= 0) {
    return financeJson({ ok: false, error: "Unknown bank line." }, 400);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, `/admin/bank-lines/${lineId}/match`, { body });
}
