// GET /api/trust/admin/tickets?status=&assignee= → the support queue.
// Admin-only BFF (401 unsigned / 403 non-admin).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/tickets${req.nextUrl.search}`);
}
