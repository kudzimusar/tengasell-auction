// GET /api/comms/notifications?limit= → GET :3005/me/notifications?limit=
//   → {items:[{id,eventKey,channel,subject,snippet,threadId,status,createdAt}]}
// Auth: Authorization: Bearer <trailbase token> → forwarded as x-tgs-user.

import type { NextRequest } from "next/server";
import { commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get("limit");
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return commsProxy(req, `/me/notifications${qs}`);
}
