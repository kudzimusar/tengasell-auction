// GET /api/gov/admin/privacy-requests — DSAR queue
// (?status=&type=&username= filters).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "type", "username"]) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return adminGovProxy(req, "/admin/privacy-requests", { ...(s ? { query: s } : {}) });
}
