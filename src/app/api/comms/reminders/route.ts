// /api/comms/reminders — trigger idempotent first-party reminder evaluation for the signed-in user.

import type { NextRequest } from "next/server";
import { commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  return commsProxy(req, "/me/reminders/evaluate", body, "POST");
}
