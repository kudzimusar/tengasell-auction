// GET /api/trust/me/enforcement → the signed-in user's own enforcement rows
// (the appeal intake needs the enforcement_id; self-scoped, no leak).

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return trustProxy(req, "/me/enforcement");
}
