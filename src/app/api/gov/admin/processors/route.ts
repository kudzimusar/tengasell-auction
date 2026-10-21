// /api/gov/admin/processors — the processor/sub-processor register
// (PRV-014/015, PRT-011, RSK-008 — cross-border transfer basis etc).
//   GET   → rows
//   POST  {name, role, location, data_categories, transfer_basis?,
//          risk_notes?, contract_status?, review_due?}
//   PATCH {id, ...}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/processors");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/processors", { body });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof (body as { id?: unknown }).id === "undefined") {
    return govJson({ ok: false, error: "id is required." }, 400);
  }
  return adminGovProxy(req, "/admin/processors", { body, methodOverride: "PATCH" });
}
