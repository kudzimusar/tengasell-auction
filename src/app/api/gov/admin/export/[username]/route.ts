// GET /api/gov/admin/export/[username] — DSAR export bundle (JSON).
// ?download=1 → served as an attachment (Content-Disposition) for the
// admin-side download button.

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const download = req.nextUrl.searchParams.get("download") === "1";
  const headers = download
    ? {
        responseHeaders: {
          "Content-Disposition": `attachment; filename="tengasell-dsar-${username}.json"`,
        },
      }
    : {};
  return adminGovProxy(req, `/admin/export/${encodeURIComponent(username)}`, headers);
}
