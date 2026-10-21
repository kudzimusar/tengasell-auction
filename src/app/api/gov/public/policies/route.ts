// GET /api/gov/public/policies — published policy list (NO AUTH).
// The browser never sees :3008 — this BFF fetches the govern-service
// server-side and relays the JSON.

import type { NextRequest } from "next/server";
import { govPublicProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return govPublicProxy(req, "/public/policies");
}
