// POST /api/platform/admin/marketplace/[id]/feature — featured toggle
// (CTL-009). Flips auctions.featured (US$2 featured-fee product, finance
// 12-b reads the same flag). Body {on: boolean}. Audit-logged.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, maintenanceBlocked, requireAdmin, userB64For, writeAudit } from "@/lib/server/platform";
import { tbGet, tbPatch, nowIso } from "@/lib/server/trailbase-admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const maintenance = maintenanceBlocked();
  if (maintenance) return maintenance;

  const { id } = await params;
  const auctionId = Number(decodeURIComponent(id));
  if (!Number.isFinite(auctionId) || auctionId <= 0) {
    return NextResponse.json({ ok: false, error: "Bad auction id." }, { status: 400 });
  }
  let body: { on?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const on = body.on === true;

  const auction = (await tbGet("auctions", auctionId)) as Record<string, unknown> | null;
  if (!auction) return NextResponse.json({ ok: false, error: "Auction not found." }, { status: 404 });

  const ok = await tbPatch("auctions", auctionId, { featured: on ? 1 : 0, updated_at: nowIso() });
  if (!ok) return NextResponse.json({ ok: false, error: "Feature toggle failed." }, { status: 502 });

  await writeAudit({
    user: userB64For(gate.username),
    action: on ? "platform:auction_featured" : "platform:auction_unfeatured",
    entity: "auctions",
    entityId: auctionId,
    source: "admin",
    payload: { title: String(auction.title ?? ""), actor: gate.username },
  });

  return NextResponse.json({ ok: true, id: auctionId, featured: on });
}
