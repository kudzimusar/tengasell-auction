// GET /api/compliance/admin/controls/export — the full 609-row worksheet as
// CSV (14 columns). The service returns {csv, count}; this BFF serves the
// raw CSV text as a download attachment.

import { NextRequest, NextResponse } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const res = await adminGovProxy(req, "/admin/controls/export");
  if (!res.ok) return res;
  const data = (await res.json().catch(() => null)) as { csv?: string } | null;
  if (!data?.csv) {
    return govJson({ ok: false, error: "Export failed — no CSV returned." }, 502);
  }
  return new NextResponse(data.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tengasell-mscs-worksheet.csv"',
      "Cache-Control": "no-store",
    },
  });
}
