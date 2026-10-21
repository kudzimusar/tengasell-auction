// GET  /api/trust/admin/macros → canned replies (SUP-008).
// POST /api/trust/admin/macros → {title, body, locale?}.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/macros");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return adminTrustProxy(req, "/admin/macros", { body });
}
