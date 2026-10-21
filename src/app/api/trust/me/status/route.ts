// GET /api/trust/me/status → the signed-in user's own suspension/roles/MFA
// state (trust-service /me/status). 401 unsigned.

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return trustProxy(req, "/me/status");
}
