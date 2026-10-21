// GET /api/finance/me/overview → GET :3006/me/overview
// Seller balance cards + escrow in flight + next payout (worklog 12-plan §F/§G).

import type { NextRequest } from "next/server";
import { financeProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return financeProxy(req, "/me/overview");
}
