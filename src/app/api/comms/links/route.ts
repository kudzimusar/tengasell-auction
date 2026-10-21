// /api/comms/links — linked channels (TUCS user side).
//
//   GET  → GET  :3005/me/links   {links:[…]}
//   POST → POST :3005/me/links   {channel, handle, displayLabel?}
//                 → {link:{…,status:"pending"}, instructions:{en,ja},
//                    sandbox?:{verifyCode}} (sandbox only in mock mode)
// Auth: Authorization: Bearer <trailbase token> → forwarded as x-tgs-user.

import type { NextRequest } from "next/server";
import { commsJson, commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return commsProxy(req, "/me/links");
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    channel?: unknown;
    handle?: unknown;
    displayLabel?: unknown;
  } | null;
  const channel = String(body?.channel ?? "");
  const handle = String(body?.handle ?? "").trim();
  if (!channel || !handle) {
    return commsJson(
      { ok: false, error: "Choose a channel and enter your handle to link it." },
      400,
    );
  }
  // the request body was already read for validation — pass it through
  return commsProxy(req, "/me/links", body);
}
