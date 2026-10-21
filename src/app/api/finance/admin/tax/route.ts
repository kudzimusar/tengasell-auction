// GET /api/finance/admin/tax → GET :3006/admin/tax?period=YYYY-MM[&format=csv]
// VAT summary cards + the vat_liability entries for the period.
// With ?format=csv the response is the VAT output ledger as a FILE DOWNLOAD
// (Content-Disposition: attachment; text/csv) for the ZIMRA pack (COM-002).

import type { NextRequest } from "next/server";
import { adminFinanceProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.search;
  if (url.searchParams.get("format") === "csv") {
    const period = (url.searchParams.get("period") ?? "").replace(/[^0-9-]/g, "");
    const fileStamp = period || new Date().toISOString().slice(0, 7);
    return adminFinanceProxy(req, "/admin/tax" + search, {
      extraHeaders: {
        "Content-Disposition": `attachment; filename="tengasell-vat-${fileStamp}.csv"`,
      },
    });
  }
  return adminFinanceProxy(req, "/admin/tax" + search);
}
