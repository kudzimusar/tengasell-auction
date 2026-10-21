// POST /api/trust/admin/screening/scan → run the listing screening scan over
// every LIVE auction (records NEW hits only; idempotent per auction+rule).

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return adminTrustProxy(req, "/admin/screening/scan", {
    body: body && typeof body === "object" ? body : {},
  });
}
