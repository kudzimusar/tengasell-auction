// GET  /api/gov/admin/policies — list + acceptance counts (admin).
// POST /api/gov/admin/policies — create policy or a NEW draft version
//   (body: {key, title, title_ja, body_en, body_ja, effective_from,
//    change_note?, owner?}; key ∈ the 8 canonical policy keys).

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/policies");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { key?: unknown }).key !== "string") {
    return govJson({ ok: false, error: "key is required." }, 400);
  }
  return adminGovProxy(req, "/admin/policies", { body });
}
