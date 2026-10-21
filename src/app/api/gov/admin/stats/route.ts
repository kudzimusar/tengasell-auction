// GET /api/gov/admin/stats — governance console overview numbers
// (policies/privacy/registers/incidents/risks/decisions/controls counters).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/stats");
}
