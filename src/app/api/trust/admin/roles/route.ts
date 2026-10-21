// GET    /api/trust/admin/roles → staff RBAC rows (CTL-002/007).
// POST   /api/trust/admin/roles → {username, role: admin|support|finance|
//         moderator|compliance, note?} — upsert.
// DELETE /api/trust/admin/roles → {username} — revoke the role row.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, "/admin/roles");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return adminTrustProxy(req, "/admin/roles", { body });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return adminTrustProxy(req, "/admin/roles", { body, methodOverride: "DELETE" });
}
