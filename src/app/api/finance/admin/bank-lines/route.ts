// GET  /api/finance/admin/bank-lines → GET  :3006/admin/bank-lines (imported lines)
// POST /api/finance/admin/bank-lines → POST :3006/admin/bank-lines
//   body: { lines: [{ amountCents|amount, direction:"in"|"out", memo,
//                     statementDate? }] } — memo refs auto-match where unique.

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/bank-lines");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/bank-lines", { body });
}
