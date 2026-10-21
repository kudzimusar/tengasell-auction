// GET /api/comms/admin/mock/inbox?limit=
//   → GET :3005/admin/mock/inbox → {emails:[…]} (pixel-accurate mock sends)

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get("limit") ?? "60";
  return adminCommsProxy(req, `/admin/mock/inbox?limit=${encodeURIComponent(limit)}`);
}
