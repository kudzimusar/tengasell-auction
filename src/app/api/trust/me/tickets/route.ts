// GET /api/trust/me/tickets → my support tickets
// POST /api/trust/me/tickets → create a ticket (body: subject, category, body,
//   priority?, order_id?, auction_id?, attachment? {name,data_base64,mime})

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return trustProxy(req, "/me/tickets");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return trustProxy(req, "/me/tickets", { body });
}
