// GET /api/comms/admin/moderation?status=&limit=
//   → GET :3005/admin/moderation → {items:[…]} (relay_log rows)

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES = new Set(["clean", "masked", "blocked", "review"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const limit = sp.get("limit") ?? "100";
  const path = status && STATUSES.has(status)
    ? `/admin/moderation?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`
    : `/admin/moderation?limit=${encodeURIComponent(limit)}`;
  return adminCommsProxy(req, path);
}
