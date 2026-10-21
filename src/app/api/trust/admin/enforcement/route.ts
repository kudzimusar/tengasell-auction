// GET  /api/trust/admin/enforcement → ladder history + current suspensions.
// POST /api/trust/admin/enforcement → {username, action: warning|restriction|
//      suspension|ban|reinstate, reason_code: REQUIRED, note?, days?} —
//      bans + open-ended/>7d suspensions come back {pending:true} for DUAL
//      APPROVAL by a DIFFERENT admin (CTL-021).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/enforcement");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return adminTrustProxy(req, "/admin/enforcement", { body });
}
