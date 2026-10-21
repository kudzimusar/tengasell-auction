// GET /api/gov/me/export — self-service data export (DSAR access).
// Returns the completed bundle when one exists, else the in-flight status
// (auto-creating an access request on first call).

import { NextRequest, NextResponse } from "next/server";
import { govJson, govProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const download = req.nextUrl.searchParams.get("download") === "1";
  if (!download) {
    return govProxy(req, "/me/export");
  }
  // ?download=1 → return ONLY the bundle as a JSON attachment.
  const res = await govProxy(req, "/me/export");
  if (!res.ok) return res;
  const data = (await res.json().catch(() => null)) as
    | { status?: string; bundle?: unknown; request_id?: number }
    | null;
  if (!data || data.status !== "completed" || !data.bundle) {
    return govJson({ ok: false, error: "Your export is not ready yet." }, 409);
  }
  const subject =
    (data.bundle as { manifest?: { subject?: string } }).manifest?.subject ?? "user";
  return new NextResponse(JSON.stringify(data.bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tengasell-export-${subject}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
