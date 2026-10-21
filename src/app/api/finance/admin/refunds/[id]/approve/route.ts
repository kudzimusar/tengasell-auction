// POST /api/finance/admin/refunds/[id]/approve → POST :3006/admin/refunds/:id/approve
// body: { decision:"approve"|"reject" (REQUIRED), reason? }
// Dual approval refunds (> threshold) need a second admin — enforced by the
// service against the forwarded x-tgs-user.

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const refundId = Number(id);
  if (!Number.isInteger(refundId) || refundId <= 0) {
    return financeJson({ ok: false, error: "Unknown refund." }, 400);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, `/admin/refunds/${refundId}/approve`, { body });
}
