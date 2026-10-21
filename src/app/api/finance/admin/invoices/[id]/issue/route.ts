// POST /api/finance/admin/invoices/[id]/issue → POST :3006/admin/invoices/:id/issue
// Draft → issued (stamps issued_at; COM-019/FIN-002/FIN-004).

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return financeJson({ ok: false, error: "Unknown invoice." }, 400);
  }
  return adminFinanceProxy(req, `/admin/invoices/${invoiceId}/issue`);
}
