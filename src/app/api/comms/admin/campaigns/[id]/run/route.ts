// POST /api/comms/admin/campaigns/[id]/run
//   → POST :3005/admin/campaigns/:id/run → {started:true,queued}

import type { NextRequest } from "next/server";
import { commsJson, adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return commsJson({ ok: false, error: "Unknown campaign." }, 400);
  }
  return adminCommsProxy(req, `/admin/campaigns/${campaignId}/run`);
}
