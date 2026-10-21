// GET /api/comms/admin/health
//   → GET :3005/health → {status, providers:{email,telegram,whatsapp,messenger}, queue:{depth,sent24h,failed}, db}

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return adminCommsProxy(req, "/health");
}
