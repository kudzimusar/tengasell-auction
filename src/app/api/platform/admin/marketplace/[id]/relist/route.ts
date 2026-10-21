// POST /api/platform/admin/marketplace/[id]/relist — put a moderation-ended
// listing back up (CTL-009). Resets ends_at (+7 days from now) and status
// "live". Only "ended" auctions can be relisted (sold auctions are final —
// those go through cancel + refund in Finance). Audit-logged.

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

  const auction = (await tbGet("auctions", auctionId)) as Record<string, unknown> | null;
  if (!auction) return NextResponse.json({ ok: false, error: "Auction not found." }, { status: 404 });
  if (String(auction.status ?? "") !== "ended") {
    return NextResponse.json(
      { ok: false, error: "Only ended auctions can be relisted (sold ones are final)." },
      { status: 409 },
    );
  }

  const endsAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const ok = await tbPatch("auctions", auctionId, { status: "live", ends_at: endsAt, updated_at: nowIso() });
  if (!ok) return NextResponse.json({ ok: false, error: "Relist failed." }, { status: 502 });

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:auction_relisted",
    entity: "auctions",
    entityId: auctionId,
    source: "admin",
    payload: { title: String(auction.title ?? ""), ends_at: endsAt, actor: gate.username },
  });

  return NextResponse.json({ ok: true, id: auctionId, status: "live", ends_at: endsAt });
}
