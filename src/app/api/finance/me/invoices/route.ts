// GET /api/finance/me/invoices → GET :3006/me/invoices (my monthly fee invoices)

import type { NextRequest } from "next/server";
import { financeProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return financeProxy(req, "/me/invoices");
}
