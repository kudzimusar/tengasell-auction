// GET /api/gov/me/policies — the policy versions I have accepted.

import type { NextRequest } from "next/server";
import { govProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return govProxy(req, "/me/policies");
}
