// POST /api/comms/links/[id]/disable → POST :3005/me/links/:id/disable → {ok:true}

import type { NextRequest } from "next/server";
import { commsJson, commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const linkId = Number(id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return commsJson({ ok: false, error: "Unknown channel link." }, 400);
  }
  return commsProxy(req, `/me/links/${linkId}/disable`);
}
