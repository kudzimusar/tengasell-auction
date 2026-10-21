// GET /api/comms/admin/suppression
//   → GET :3005/admin/suppression → {items:[…]} (channel+handle-scoped)

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminCommsProxy(req, "/admin/suppression");
}
