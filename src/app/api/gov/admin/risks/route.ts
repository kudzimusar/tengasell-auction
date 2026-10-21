// /api/gov/admin/risks — the risk register (RSK-001..010).
//   GET    ?status= → rows (score = likelihood × impact, sorted by score)
//   POST   {title, category, likelihood: 1..5, impact: 1..5, owner,
//          ref?, status?, controls?: string[], review_due?, notes?}
//   PATCH  {id, ...}
//   DELETE ?id=

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, "/admin/risks", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/risks", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/risks", { body, methodOverride: "PATCH" });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return govJson({ ok: false, error: "id query param required." }, 400);
  }
  return adminGovProxy(req, `/admin/risks?id=${encodeURIComponent(id)}`, {
    methodOverride: "DELETE",
  });
}
