// POST /api/comms/links/[id]/verify {code}
//   → POST :3005/me/links/:id/verify → {ok:true, link:{…,status:"verified"}}

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
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = String(body?.code ?? "").trim();
  if (!code) {
    return commsJson({ ok: false, error: "Enter the code we sent you." }, 400);
  }
  // the request body was already read for validation — pass it through
  return commsProxy(req, `/me/links/${linkId}/verify`, body);
}
