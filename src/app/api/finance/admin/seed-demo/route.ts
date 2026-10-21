// POST /api/finance/admin/seed-demo → POST :3006/admin/seed-demo
// Idempotent demo seeder: funds + releases historic orders, featured fee,
// refund example, pending payout for rufaro, monthly invoice, bank lines.

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return adminFinanceProxy(req, "/admin/seed-demo");
}
