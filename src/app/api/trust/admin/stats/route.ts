// GET /api/trust/admin/stats → console overview counters (open tickets, SLA
// breaches, pending reports, enforcement 30d, screening pending, appeals,
// cases, CSAT average).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/stats");
}
