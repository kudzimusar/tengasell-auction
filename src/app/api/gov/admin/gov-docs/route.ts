// GET /api/gov/admin/gov-docs — governance document bundle: threat model +
// security reviews + training records (SEC-002/022/025).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/gov-docs");
}
