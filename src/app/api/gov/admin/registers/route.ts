// GET /api/gov/admin/registers — the register catalogue (names + counts)
// powering the admin register picker.

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/registers");
}
