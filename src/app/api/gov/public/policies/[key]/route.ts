// GET /api/gov/public/policies/[key] — published policy body (NO AUTH).
// ?locale=ja returns the Japanese body (falls back to EN with
// {fallback:true}); 404-style payload when the policy is not published.

import type { NextRequest } from "next/server";
import { govPublicProxy } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const locale = req.nextUrl.searchParams.get("locale");
  const qs = locale ? `locale=${encodeURIComponent(locale)}` : "";
  return govPublicProxy(req, `/public/policies/${encodeURIComponent(key)}`, {
    ...(qs ? { query: qs } : {}),
  });
}
