// GET /api/geo/search?q= — forward geocoding (Nominatim-compatible results).

import { NextRequest, NextResponse } from "next/server";
import { geoSearch } from "@/lib/server/geo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ ok: false, error: "Query must be at least 2 characters." }, { status: 400 });
  }
  try {
    const results = await geoSearch(q, 5);
    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, error: "Geocoding is temporarily unavailable." }, { status: 503 });
  }
}
