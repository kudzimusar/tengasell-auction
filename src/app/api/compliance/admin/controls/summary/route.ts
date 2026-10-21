// GET /api/compliance/admin/controls/summary — counts by status /
// applicability / domain / criticality + in_scope totals (the register
// header progress figures).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/controls/summary");
}
