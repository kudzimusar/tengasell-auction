// GET /api/geo/route?fromLat=&fromLng=&toLat=&toLng= — OSRM-compatible driving
// route (distance, duration, geometry) for delivery previews and tracking.

import { NextRequest, NextResponse } from "next/server";
import { geoRoute } from "@/lib/server/geo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const fromLat = Number(p.get("fromLat"));
  const fromLng = Number(p.get("fromLng"));
  const toLat = Number(p.get("toLat"));
  const toLng = Number(p.get("toLng"));
  const nums = [fromLat, fromLng, toLat, toLng];
  if (nums.some((n) => !Number.isFinite(n)) || Math.abs(fromLat) > 90 || Math.abs(toLat) > 90) {
    return NextResponse.json({ ok: false, error: "fromLat, fromLng, toLat and toLng are required." }, { status: 400 });
  }
  try {
    const route = await geoRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
    return NextResponse.json({ ok: true, ...route, distanceKm: Math.round(route.distanceMeters / 100) / 10 });
  } catch {
    return NextResponse.json({ ok: false, error: "Routing is temporarily unavailable." }, { status: 503 });
  }
}
