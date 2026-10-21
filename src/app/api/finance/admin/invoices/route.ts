// GET  /api/finance/admin/invoices → GET  :3006/admin/invoices
// POST /api/finance/admin/invoices → POST :3006/admin/invoices
//   body: { username, period:"YYYY-MM" } — creates a draft monthly fee
//   invoice (fee + VAT totals computed from the released orders).

import type { NextRequest } from "next/server";
import { adminFinanceProxy, financeJson } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/invoices");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminFinanceProxy(req, "/admin/invoices", { body });
}
