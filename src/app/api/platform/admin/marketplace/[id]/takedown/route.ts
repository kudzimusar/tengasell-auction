// POST /api/platform/admin/marketplace/[id]/takedown — remove a listing
// (CTL-009). Reason code REQUIRED (audited). Sets status "ended" (the only
// closed state the trade engine honours for live auctions — field names
// verified against trade-engine/index.ts), notifies the seller on-platform
// (TrailBase notifications row, the guaranteed channel), audit-logged.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, maintenanceBlocked, requireAdmin, userB64For, writeAudit } from "@/lib/server/platform";
import { tbGet, tbPatch, tbCreate, nowIso } from "@/lib/server/trailbase-admin";

const REASON_CODES = [
  "prohibited_item",
  "counterfeit",
  "ip_violation",
  "off_platform_payment",
  "fraud_suspected",
  "duplicate",
  "other",
];

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

  let body: { reason_code?: string; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed request." }, { status: 400 });
  }
  const reasonCode = String(body.reason_code ?? "");
  const note = String(body.note ?? "").trim();
  if (!REASON_CODES.includes(reasonCode)) {
    return NextResponse.json(
      { ok: false, error: `A takedown reason code is required: ${REASON_CODES.join(", ")}.` },
      { status: 400 },
    );
  }

  const auction = (await tbGet("auctions", auctionId)) as Record<string, unknown> | null;
  if (!auction) {
    return NextResponse.json({ ok: false, error: "Auction not found." }, { status: 404 });
  }
  if (String(auction.status ?? "") === "sold") {
    return NextResponse.json(
      { ok: false, error: "This auction already sold — use cancel + refund (Finance console) instead." },
      { status: 409 },
    );
  }
  if (String(auction.status ?? "") === "ended") {
    return NextResponse.json({ ok: false, error: "This auction is already ended." }, { status: 409 });
  }

  const ok = await tbPatch("auctions", auctionId, { status: "ended", updated_at: nowIso() });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Takedown failed on the records API." }, { status: 502 });
  }

  // on-platform seller notification (guaranteed channel — no template gamble)
  if (auction.user) {
    await tbCreate("notifications", {
      user: auction.user,
      type: "info",
      title: "Your listing was removed by moderation",
      body: `“${String(auction.title ?? "")}” was taken down (${reasonCode}${note ? `: ${note}` : ""}). If you believe this was a mistake, contact support from Help & SLA.`,
      link: "/#/help",
      read: 0,
      created_at: nowIso(),
    });
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:auction_takedown",
    entity: "auctions",
    entityId: auctionId,
    source: "admin",
    payload: { title: String(auction.title ?? ""), seller: String(auction.seller_username ?? ""), reason_code: reasonCode, note, actor: gate.username },
  });

  return NextResponse.json({ ok: true, id: auctionId, status: "ended" });
}
