// GET /api/geo/quote?origin=lat,lng&destination=lat,lng&shipping=courier|nationwide|pickup
// — delivery price + ETA quote for checkout.

import { NextRequest, NextResponse } from "next/server";
import { geoDeliveryQuote, type DeliveryQuote } from "@/lib/server/geo";

export const dynamic = "force-dynamic";

function parseCoord(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const origin = parseCoord(p.get("origin"));
  const destination = parseCoord(p.get("destination"));
  const shipping = (p.get("shipping") ?? "courier") as DeliveryQuote["shipping"];
  if (!origin || !destination) {
    return NextResponse.json(
      { ok: false, error: "origin and destination must be 'lat,lng' pairs." },
      { status: 400 },
    );
  }
  if (!["courier", "nationwide", "pickup"].includes(shipping)) {
    return NextResponse.json(
      { ok: false, error: "shipping must be courier, nationwide or pickup." },
      { status: 400 },
    );
  }
  try {
    const quote = await geoDeliveryQuote({ origin, destination, shipping });
    return NextResponse.json(quote);
  } catch {
    return NextResponse.json({ ok: false, error: "Quote service is temporarily unavailable." }, { status: 503 });
  }
}
