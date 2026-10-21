// POST /api/trust/admin/seed-demo → idempotent demo seed (second admin
// trustops, role rows, macros, screening rules, sample tickets/report,
// initial scan). Admin-only.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return adminTrustProxy(req, "/admin/seed-demo", {
    body: body && typeof body === "object" ? body : {},
  });
}
