// GET /api/trust/admin/reports?status= → abuse/fraud report queue (TNS-001).
// Admin-only.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/reports${req.nextUrl.search}`);
}
