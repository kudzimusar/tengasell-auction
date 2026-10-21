// /api/compliance/admin/findings — compliance findings (F-IMP..F-RSK).
//   GET   ?status= → rows
//   POST  {control_id, class: F-IMP|F-EVD|F-AUTH|F-ENV|F-POL|F-RSK,
//         description, severity?, owner?}
//   PATCH {id, status?: open|remediated|waived, resolution?, owner?,
//         severity?}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, "/admin/findings", { ...(qs ? { query: qs } : {}) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/findings", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/findings", { body, methodOverride: "PATCH" });
}
