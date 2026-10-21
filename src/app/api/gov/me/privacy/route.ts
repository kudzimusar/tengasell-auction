// GET /api/gov/me/privacy — my Privacy Centre dashboard (requests,
// acceptances, active processing flags). 401 unsigned.

import type { NextRequest } from "next/server";
import { govProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return govProxy(req, "/me/privacy");
}
