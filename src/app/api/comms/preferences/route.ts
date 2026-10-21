// /api/comms/preferences — notification preference matrix (TUCS user side).
//
//   GET → GET :3005/me/preferences
//         {matrix:[{eventKey,labelEn,labelJa,group,default:{…},user:{…}}],
//          marketingOptIn:{email,telegram,whatsapp,messenger}}
//   PUT → PUT :3005/me/preferences
//         {matrix:[{eventKey,email,telegram,whatsapp,messenger}],
//          marketingOptIn:{…}} → {ok:true}
// Auth: Authorization: Bearer <trailbase token> → forwarded as x-tgs-user.

import type { NextRequest } from "next/server";
import { commsProxy } from "@/lib/server/comms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return commsProxy(req, "/me/preferences");
}

export async function PUT(req: NextRequest) {
  return commsProxy(req, "/me/preferences");
}
