// GET /api/trust/admin/signins?username= → sign-in activity log (SUP-002
// contact history — recorded by the sign-in gate via /internal/signin).
// 12-e's platform routes do not surface this; the trust console does.

import type { NextRequest } from "next/server";
import { adminTrustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminTrustProxy(req, `/admin/signins${req.nextUrl.search}`);
}
