// GET  /api/gov/me/privacy-requests — my DSAR request list.
// POST /api/gov/me/privacy-requests — submit a request
//   (body: {type: access|correction|deletion|portability|restriction|
//    objection, details?}; one open request per type, 30-day due date).

import type { NextRequest } from "next/server";
import { govJson, govProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return govProxy(req, "/me/privacy-requests");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { type?: unknown }).type !== "string") {
    return govJson({ ok: false, error: "type is required." }, 400);
  }
  return govProxy(req, "/me/privacy-requests", { body });
}
