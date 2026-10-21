// GET /api/trust/admin/health-score?username= → on-demand seller health
// score (MKT-026): dispatch SLA, dispute rate, rating, flags → 0–100.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/health-score${req.nextUrl.search}`);
}
