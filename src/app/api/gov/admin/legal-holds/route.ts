// /api/gov/admin/legal-holds — legal holds (block DSAR deletion while active).
//   GET  ?username= → hold history (active = lifted_at NULL)
//   POST {username, reason, case_ref?} → create (one active per user)

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  const qs = username ? `username=${encodeURIComponent(username)}` : "";
  return adminGovProxy(req, "/admin/legal-holds", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/legal-holds", { body });
}
