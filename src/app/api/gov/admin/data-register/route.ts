// /api/gov/admin/data-register — the data processing register (DAT-001..009).
//   GET   ?category= → rows
//   POST  {asset, store, category, purpose, legal_basis, owner, retention,
//         retention_days?, processing_notes?, notes?}
//   PATCH {id, ...} → partial update

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  const qs = category ? `category=${encodeURIComponent(category)}` : "";
  return adminGovProxy(req, "/admin/data-register", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/data-register", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/data-register", { body, methodOverride: "PATCH" });
}
