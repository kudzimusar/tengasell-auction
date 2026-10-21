// GET /api/trust/admin/appeals → appeal queue joined with the enforcement rows.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/appeals");
}
