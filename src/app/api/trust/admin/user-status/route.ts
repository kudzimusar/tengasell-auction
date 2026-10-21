// GET /api/trust/admin/user-status?username= → customer record lookup
// (SUP-001): suspension state, roles, MFA — for the console side panels.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/user-status${req.nextUrl.search}`);
}
