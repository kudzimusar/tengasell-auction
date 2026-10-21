// POST /api/comms/admin/moderation/[id]/action {action:"approve"|"block"}
//   → POST :3005/admin/moderation/:id/action → {ok:true}

import type { NextRequest } from "next/server";
import { commsJson, adminCommsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return commsJson({ ok: false, error: "Unknown moderation item." }, 400);
  }
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = String(body?.action ?? "");
  if (action !== "approve" && action !== "block") {
    return commsJson({ ok: false, error: "Action must be approve or block." }, 400);
  }
  return adminCommsProxy(req, `/admin/moderation/${itemId}/action`, { action });
}
