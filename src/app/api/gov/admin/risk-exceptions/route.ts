// /api/gov/admin/risk-exceptions — time-bounded risk acceptances
// (MSCS Template C).
//   GET   ?status= → rows (auto-expired past-due)
//   POST  {reason, risk_statement, criticality?, compensating_controls?,
//         owner, approved_by?, expires_at, affected_controls?: string[]}
//   PATCH {id, ...}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, "/admin/risk-exceptions", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/risk-exceptions", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/risk-exceptions", { body, methodOverride: "PATCH" });
}
