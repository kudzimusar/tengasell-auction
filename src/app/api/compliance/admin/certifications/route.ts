// /api/compliance/admin/certifications — MSCS certification records.
//   GET  → latest 20 records (gates + report parsed)
//   POST {profile, scope, source_authority, environment,
//        disposition: PASS|PASS_WITH_CONDITIONS|FAIL, score?, gates?: [],
//        valid_until?, report? (JSON string)}

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminGovProxy(req, "/admin/certifications");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return govJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return adminGovProxy(req, "/admin/certifications", { body });
}
