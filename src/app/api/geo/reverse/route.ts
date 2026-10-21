// GET /api/geo/reverse?lat=&lng= — reverse geocoding for GPS coordinates.

import { NextRequest, NextResponse } from "next/server";
import { geoReverse } from "@/lib/server/geo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ ok: false, error: "Valid lat and lng are required." }, { status: 400 });
  }
  try {
    const result = await geoReverse(lat, lng);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "Reverse geocoding is temporarily unavailable." }, { status: 503 });
  }
}
