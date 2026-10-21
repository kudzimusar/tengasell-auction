// GET /api/platform/admin/marketplace — auction administration list
// (CTL-009). Search by title/seller + status filter straight from the
// TrailBase records API (admin token). Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireAdmin } from "@/lib/server/platform";
import { tbList } from "@/lib/server/trailbase-admin";

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const status = req.nextUrl.searchParams.get("status") ?? "";

  const params: Record<string, string | number> = {
    order: "-created_at",
    limit: 40,
  };
  if (q) {
    // title OR seller: two passes would double-fetch — one title search plus
    // client-side seller overlay is enough for the console; honest + simple.
    params["filter[title][$like]"] = `%${q}%`;
  }
  if (status && status !== "all") params["filter[status][$eq]"] = status;

  const records = await tbList("auctions", params);

  // when searching also match sellers (client joins) — fetch by seller too
  let sellerRecords: Record<string, unknown>[] = [];
  if (q) {
    sellerRecords = await tbList("auctions", {
      "filter[seller_username][$eq]": q,
      order: "-created_at",
      limit: 40,
    });
  }
  const seen = new Set<number>();
  const auctions = [...records, ...sellerRecords]
    .filter((r) => {
      const id = Number(r.id ?? 0);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((r) => ({
      id: Number(r.id ?? 0),
      title: String(r.title ?? ""),
      seller: String(r.seller_username ?? ""),
      category: String(r.category ?? ""),
      status: String(r.status ?? ""),
      featured: Number(r.featured ?? 0) === 1,
      current_price: Number(r.current_price ?? 0),
      bid_count: Number(r.bid_count ?? 0),
      views: Number(r.views ?? 0),
      ends_at: String(r.ends_at ?? ""),
      created_at: String(r.created_at ?? ""),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 40);

  return NextResponse.json({ ok: true, auctions });
}
