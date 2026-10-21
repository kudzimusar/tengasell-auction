// POST /api/compliance/admin/controls/import — re-import the MSCS worksheet
// (609 rows, idempotent upsert; admin-set statuses/evidence are preserved).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return adminGovProxy(req, "/admin/controls/import", { body: {} });
}
