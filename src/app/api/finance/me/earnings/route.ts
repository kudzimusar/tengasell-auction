// GET /api/finance/me/earnings → GET :3006/me/earnings
// Order-by-order fee/earnings breakdown + totals (MKT-025/GOV-004).

import type { NextRequest } from "next/server";
import { financeProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return financeProxy(req, "/me/earnings");
}
