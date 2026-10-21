// POST /api/comms/admin/campaigns/[id]/audience
//   → POST :3005/admin/campaigns/:id/audience
// Accepts either explicit {userIds:[…]} or BFF-side segment resolution
// {segmentKey, category?} (best-effort TrailBase queries, all_users fallback).

import type { NextRequest } from "next/server";
import { commsJson, adminCommsProxy } from "@/lib/server/comms";
import { isSegmentKey, resolveSegment } from "@/lib/server/comms-admin";

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

  const body = (await req.json().catch(() => null)) as {
    userIds?: unknown;
    segmentKey?: unknown;
    category?: unknown;
  } | null;

  // explicit userIds → pass straight through
  if (Array.isArray(body?.userIds)) {
    return adminCommsProxy(req, `/admin/campaigns/${campaignId}/audience`, {
      userIds: (body.userIds as unknown[]).filter(
        (u): u is string => typeof u === "string" && u.trim().length > 0,
      ),
    });
  }

  // segmentKey → resolve BFF-side, then forward the userIds
  if (isSegmentKey(body?.segmentKey)) {
    const category = typeof body?.category === "string" ? body.category.trim() : undefined;
    const resolution = await resolveSegment(body.segmentKey, category);
    const res = await adminCommsProxy(req, `/admin/campaigns/${campaignId}/audience`, {
      userIds: resolution.userIds,
    });
    if (!res.ok) return res;
    const data = (await res.json().catch(() => null)) as { resolved?: number } | null;
    return commsJson({
      ok: true,
      resolved: typeof data?.resolved === "number" ? data.resolved : resolution.userIds.length,
      ...(resolution.fallback ? { segmentFallback: resolution.fallback } : {}),
    });
  }

  return commsJson(
    { ok: false, error: "Provide userIds or a segmentKey for the audience." },
    400,
  );
}
