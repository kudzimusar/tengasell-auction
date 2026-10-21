// GET /api/geo/autocomplete?q=&lat=&lng= — Photon-style type-ahead suggestions
// for address inputs (checkout, profile address).

import { NextRequest, NextResponse } from "next/server";
import { geoAutocomplete } from "@/lib/server/geo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }
  const latRaw = Number(req.nextUrl.searchParams.get("lat"));
  const lngRaw = Number(req.nextUrl.searchParams.get("lng"));
  const near =
    Number.isFinite(latRaw) && Number.isFinite(lngRaw) ? { lat: latRaw, lng: lngRaw } : undefined;
  try {
    const results = await geoAutocomplete(q, near, 6);
    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, error: "Autocomplete is temporarily unavailable." }, { status: 503 });
  }
}
