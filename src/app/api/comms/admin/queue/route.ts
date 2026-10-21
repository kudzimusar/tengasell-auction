// GET /api/comms/admin/queue?status=&limit=
//   → GET :3005/admin/queue → {items:[…]} (delivery log rows)

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES = new Set(["queued", "sending", "sent", "failed", "dead"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const limit = sp.get("limit") ?? "100";
  const path = status && STATUSES.has(status)
    ? `/admin/queue?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`
    : `/admin/queue?limit=${encodeURIComponent(limit)}`;
  return adminCommsProxy(req, path);
}
