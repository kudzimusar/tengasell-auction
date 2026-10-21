// /api/comms/admin/campaigns — campaign list + create (TUCS admin side).
//
//   GET  → GET :3005/admin/campaigns → {campaigns:[{…,stats}]}
//   POST → 1) create the campaign on :3005,
//          2) resolve the segment BFF-side (best-effort TrailBase queries),
//          3) POST the userIds to :3005/admin/campaigns/:id/audience,
//          → {ok, campaign, resolved, requested, segmentFallback?}
// Admin gate: verified TrailBase session must carry the admin flag (403 else).

import type { NextRequest } from "next/server";
import { commsJson, adminCommsProxy } from "@/lib/server/comms";
import { isSegmentKey, resolveSegment } from "@/lib/server/comms-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANNELS = ["email", "telegram", "whatsapp", "messenger"] as const;
const TEMPLATES = [
  "marketing.digest",
  "marketing.spotlight",
  "marketing.winback",
] as const;

export async function GET(req: NextRequest) {
  return adminCommsProxy(req, "/admin/campaigns");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    segmentKey?: unknown;
    category?: unknown;
    channels?: unknown;
    templateKey?: unknown;
    locale?: unknown;
    scheduleAt?: unknown;
  } | null;

  const name = String(body?.name ?? "").trim().slice(0, 160);
  const templateKey = String(body?.templateKey ?? "").trim();
  const channels = Array.isArray(body?.channels)
    ? (body.channels as unknown[]).filter(
        (c): c is string => typeof c === "string" && (CHANNELS as readonly string[]).includes(c),
      )
    : [];
  const segmentKey = isSegmentKey(body?.segmentKey) ? body.segmentKey : "all_users";
  const category = typeof body?.category === "string" ? body.category.trim() : undefined;
  const locale = body?.locale === "ja" ? "ja" : "en";
  const scheduleAtRaw = typeof body?.scheduleAt === "string" ? body.scheduleAt.trim() : "";
  const scheduleAt = scheduleAtRaw ? new Date(scheduleAtRaw).toISOString() : undefined;

  if (!name) {
    return commsJson({ ok: false, error: "Give the campaign a name." }, 400);
  }
  if (channels.length === 0) {
    return commsJson({ ok: false, error: "Pick at least one channel." }, 400);
  }
  if (!(TEMPLATES as readonly string[]).includes(templateKey)) {
    return commsJson({ ok: false, error: "Unknown marketing template." }, 400);
  }
  if (scheduleAtRaw && Number.isNaN(new Date(scheduleAtRaw).getTime())) {
    return commsJson({ ok: false, error: "The schedule time is not a valid date." }, 400);
  }

  // 1. create the campaign on the comms-service
  const createBody = {
    name,
    segmentKey,
    channels,
    templateKey,
    locale,
    ...(scheduleAt ? { scheduleAt } : {}),
  };
  const createRes = await adminCommsProxy(req, "/admin/campaigns", createBody);
  if (!createRes.ok) {
    return createRes; // 4xx/5xx from the service passes through
  }
  const created = (await createRes.json().catch(() => null)) as
    | { campaign?: { id?: number } }
    | null;
  const campaignId = Number(created?.campaign?.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return commsJson(
      { ok: false, error: "Campaign was created but the audience could not be resolved." },
      502,
    );
  }

  // 2. resolve the segment BFF-side (best-effort → all_users fallback)
  const resolution = await resolveSegment(segmentKey, category);

  // 3. push the resolved userIds as the campaign audience
  const audienceRes = await adminCommsProxy(req, `/admin/campaigns/${campaignId}/audience`, {
    userIds: resolution.userIds,
  });
  let resolved = resolution.userIds.length;
  if (audienceRes.ok) {
    const data = (await audienceRes.json().catch(() => null)) as { resolved?: number } | null;
    if (typeof data?.resolved === "number") resolved = data.resolved;
  }

  // re-read the created campaign (with live stats) for the response.
  // NOTE: methodOverride "GET" — the incoming request is POST and its body
  // stream is already consumed above, so the proxy must not re-read it.
  const finalRes = await adminCommsProxy(req, "/admin/campaigns", undefined, "GET");
  const list = finalRes.ok
    ? ((await finalRes.json().catch(() => null)) as { campaigns?: { id?: number }[] } | null)
    : null;
  const campaign =
    (list?.campaigns ?? []).find((c) => Number(c.id) === campaignId) ??
    created?.campaign ??
    null;

  return commsJson({
    ok: true,
    campaign,
    resolved,
    requested: resolution.userIds.length,
    ...(resolution.fallback ? { segmentFallback: resolution.fallback } : {}),
  });
}
