// /api/compliance/admin/evidence — the evidence manifest (E1..E6 classes).
//   GET   → rows (control_ids parsed)
//   POST  {control_ids: string[], class: E1..E6, source, authority,
//         observed?, expected?, integrity_ref?, validity?}
//   PATCH {id, ...}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/evidence");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/evidence", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/evidence", { body, methodOverride: "PATCH" });
}
