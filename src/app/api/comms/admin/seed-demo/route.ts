// POST /api/comms/admin/seed-demo
//   → POST :3005/admin/seed-demo → {ok:true, summary:{alreadySeeded,…}}
// Idempotent demo seeder (verified links, prefs, events, one finished campaign).

import type { NextRequest } from "next/server";
import { adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return adminCommsProxy(req, "/admin/seed-demo");
}
