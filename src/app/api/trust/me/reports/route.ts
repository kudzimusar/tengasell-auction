// GET /api/trust/me/reports → my abuse reports + status
// POST /api/trust/me/reports → report a listing/profile/message/order.

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return trustProxy(req, "/me/reports");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return trustProxy(req, "/me/reports", { body });
}
