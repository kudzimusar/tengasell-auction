// GET /api/gov/admin/policies/[key]/preview/[version] — draft preview
// (?locale=ja supported; CMS-029, admin only).

import type { NextRequest } from "next/server";
import { adminGovProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string; version: string }> },
) {
  const { key, version } = await params;
  const locale = req.nextUrl.searchParams.get("locale");
  const qs = locale ? `locale=${encodeURIComponent(locale)}` : "";
  return adminGovProxy(
    req,
    `/admin/policies/${encodeURIComponent(key)}/preview/${encodeURIComponent(version)}`,
    { ...(qs ? { query: qs } : {}) },
  );
}
