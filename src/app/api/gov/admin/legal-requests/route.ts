// /api/gov/admin/legal-requests — lawful requests, IP takedowns, subpoenas.
//   GET   ?status= → request log (minimisation notes + response log)
//   POST  {type: lawful_request|ip_takedown|subpoena, requester, scope,
//         received_at?, legal_review_by?, minimisation_note?}
//   PATCH {id, status?, legal_review_by?, minimisation_note?, note?}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, "/admin/legal-requests", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/legal-requests", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/legal-requests", { body, methodOverride: "PATCH" });
}
