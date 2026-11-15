// /api/comms/subscriptions — first-party auction event/lot/item follow subscriptions (UX-01 R3A).
// Proxies to TUCS comms-service (:3005) using the authenticated user's x-tgs-user header.

import type { NextRequest } from "next/server";
import { commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search || "";
  return commsProxy(req, `/me/subscriptions${qs}`);
}

export async function POST(req: NextRequest) {
  return commsProxy(req, "/me/subscriptions");
}

export async function DELETE(req: NextRequest) {
  const targetType = req.nextUrl.searchParams.get("targetType");
  const targetId = req.nextUrl.searchParams.get("targetId");
  if (targetType && targetId) {
    return commsProxy(
      req,
      `/me/subscriptions/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
      undefined,
      "DELETE",
    );
  }
  let parsed: unknown = {};
  try {
    parsed = await req.json();
  } catch {
    parsed = {};
  }
  return commsProxy(req, "/me/subscriptions/unsubscribe", parsed, "POST");
}
