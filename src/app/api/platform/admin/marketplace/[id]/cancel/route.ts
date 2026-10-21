// POST /api/platform/admin/marketplace/[id]/cancel — cancel an order-backed
// listing with a refund pointer (CTL-009). Sets status "ended" with a
// cancel reason, notifies buyer + seller on-platform, audit-logs, and
// returns the finance pointer (refunds are the finance console's domain —
// owner 12-b). Body: {reason_code, note?}.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, maintenanceBlocked, requireAdmin, userB64For, writeAudit } from "@/lib/server/platform";
import { tbGet, tbPatch, tbCreate, tbList, nowIso } from "@/lib/server/trailbase-admin";

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
  const reasonCode = String(body.reason_code ?? "seller_request");
  const note = String(body.note ?? "").trim();
  if (!reasonCode) {
    return NextResponse.json({ ok: false, error: "A cancellation reason is required." }, { status: 400 });
  }

  const auction = (await tbGet("auctions", auctionId)) as Record<string, unknown> | null;
  if (!auction) return NextResponse.json({ ok: false, error: "Auction not found." }, { status: 404 });
  if (String(auction.status ?? "") === "ended") {
    return NextResponse.json({ ok: false, error: "This auction is already ended." }, { status: 409 });
  }

  const ok = await tbPatch("auctions", auctionId, { status: "ended", updated_at: nowIso() });
  if (!ok) return NextResponse.json({ ok: false, error: "Cancel failed." }, { status: 502 });

  // find any orders on this auction → notify the buyer + seller (refund path)
  const orders = await tbList("orders", { "filter[auction_id][$eq]": auctionId, limit: 10 });
  for (const o of orders) {
    for (const [userCol, label] of [
      ["buyer_user", "buyer"],
      ["seller_user", "seller"],
    ] as const) {
      if (o[userCol]) {
        await tbCreate("notifications", {
          user: o[userCol],
          type: "info",
          title: "Order cancelled by Tengasell",
          body: `The order for “${String(auction.title ?? "")}” was cancelled (${reasonCode}). Refunds are processed by the finance team — you'll get a confirmation with the credit note.`,
          link: "/#/my/orders",
          read: 0,
          created_at: nowIso(),
        });
      }
    }
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:auction_cancelled",
    entity: "auctions",
    entityId: auctionId,
    source: "admin",
    payload: {
      title: String(auction.title ?? ""),
      reason_code: reasonCode,
      note,
      orders_affected: orders.length,
      actor: gate.username,
    },
  });

  return NextResponse.json({
    ok: true,
    id: auctionId,
    status: "ended",
    orders_affected: orders.length,
    finance_pointer: "/admin/refunds",
  });
}
