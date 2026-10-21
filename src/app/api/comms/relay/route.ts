// GET /api/comms/relay?threadId= → GET :3005/me/relay?threadId=
//   → {items:[{id,threadId,direction,fromUserId,toUserId,channel,
//              maskedContent,moderationStatus,createdAt}]}
// Mediated-relay rows the signed-in user is party to (Task 11-d — additive).
// The messages module merges direction='in' rows into thread views as
// cross-channel replies ("via WhatsApp / Telegram / Email" badges).
// Auth: Authorization: Bearer <trailbase token> → forwarded as x-tgs-user.

import type { NextRequest } from "next/server";
import { commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  const qs = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return commsProxy(req, `/me/relay${qs}`);
}
