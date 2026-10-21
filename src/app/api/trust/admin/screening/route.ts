// GET /api/trust/admin/screening → screening rules + hydrated hits + stats
// (MKT-008/029). Admin-only.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/screening");
}
