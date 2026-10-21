// GET /api/finance/admin/ledger → GET :3006/admin/ledger
// Query passthrough: ?account=<account>&limit=<n> (entries + distinct
// accounts) and ?verify=1 (FIN-009 integrity proof: transactions + failures).

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const search = new URL(req.url).search;
  return adminFinanceProxy(req, "/admin/ledger" + search);
}
