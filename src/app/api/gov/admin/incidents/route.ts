// GET  /api/gov/admin/incidents — incident list (?status=).
// POST /api/gov/admin/incidents — declare a new incident
//   (body: {title, severity: S1..S4, type: outage|security|privacy|data|
//    third_party, impact?, commander?, detected_at?, regulatory_reportable?};
//    ref auto INC-YYYY-NNN).

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, "/admin/incidents", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/incidents", { body });
}
