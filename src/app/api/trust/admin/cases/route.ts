// GET /api/trust/admin/cases?status= → abuse + dispute cases (TNS-002/005).
// Admin-only.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/cases${req.nextUrl.search}`);
}
