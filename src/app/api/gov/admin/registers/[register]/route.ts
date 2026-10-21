// /api/gov/admin/registers/[register] — the generic register engine.
//   GET    ?status=   → rows (strategy + compliance_calendar served from
//                      their own tables with their own shapes)
//   POST              → create  {title, key?, body?, status?, owner?,
//                      due_date?, meta?}  (calendar: {obligation,
//                      jurisdiction?, authority, due_date, status?, notes?};
//                      strategy: {key, title, body, owner?, status?})
//   PATCH  {id, ...}  → partial update (COALESCE semantics)
//   DELETE ?id=       → remove a row
//
// register ∈ strategy|entity|ownership|directors|corporate_policies|
//   delegated_authority|contracts|employees|contractors|assets|licenses|
//   domains|insurance|procurement|vendors|approvals|integrations|
//   regulatory|notices|compliance_calendar (20 registers).

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REGISTER_RE =
  /^(strategy|entity|ownership|directors|corporate_policies|delegated_authority|contracts|employees|contractors|assets|licenses|domains|insurance|procurement|vendors|approvals|integrations|regulatory|notices|compliance_calendar)$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ register: string }> },
) {
  const { register } = await params;
  const status = req.nextUrl.searchParams.get("status");
  const qs = status ? `status=${encodeURIComponent(status)}` : "";
  return adminGovProxy(req, `/admin/registers/${register}`, { ...(qs ? { query: qs } : {}) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ register: string }> },
) {
  const { register } = await params;
  if (!REGISTER_RE.test(register)) {
    return govJson({ ok: false, error: "Unknown register." }, 404);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, `/admin/registers/${register}`, { body });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ register: string }> },
) {
  const { register } = await params;
  if (!REGISTER_RE.test(register)) {
    return govJson({ ok: false, error: "Unknown register." }, 404);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, `/admin/registers/${register}`, {
    body,
    methodOverride: "PATCH",
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ register: string }> },
) {
  const { register } = await params;
  if (!REGISTER_RE.test(register)) {
    return govJson({ ok: false, error: "Unknown register." }, 404);
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return govJson({ ok: false, error: "id query param required." }, 400);
  }
  return adminGovProxy(req, `/admin/registers/${register}?id=${encodeURIComponent(id)}`, {
    methodOverride: "DELETE",
  });
}
