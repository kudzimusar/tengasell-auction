// GET /api/compliance/admin/controls — the 609-control MSCS register.
// Filters pass straight through: ?domain=&status=&applicability=&q=&page=&limit=
// (page defaults 1, limit 50 — the console paginates at 50/page).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PASS_KEYS = ["domain", "status", "applicability", "criticality", "q", "page", "limit"];

export async function GET(req: NextRequest) {
  const qs = new URLSearchParams();
  for (const k of PASS_KEYS) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return adminGovProxy(req, "/admin/controls", { ...(s ? { query: s } : {}) });
}
