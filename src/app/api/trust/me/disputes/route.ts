// GET  /api/trust/me/disputes?order_id= → my dispute cases (with the
//      joined ticket status — powers the "dispute exists" chip).
// POST /api/trust/me/disputes → open a dispute (creates ticket + case).
//      Body: {order_id, reason_code, note, order: snapshot} — the service
//      records the snapshot in the case evidence (7-day window is checked
//      client-side, v1 documented).

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return trustProxy(req, `/me/disputes${req.nextUrl.search}`);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return trustProxy(req, "/me/disputes", { body });
}
