// /events + /internal/refund — the intake surface of the finance service.
//
// POST /events is called by the trade-engine (fire-and-forget, §F):
//   order.paid          {orderId, buyer, seller, itemPrice, shipping, method, reference}
//   order.delivered     {orderId}
//   order.dispute_window_elapsed {orderId}
//   order.cancelled     {orderId, reason?}
//   listing.featured    {auctionId, seller, auctionRef}  ← Gap-8 sell wizard fee
// POST /internal/refund is called by the trust-service with the shared
// x-tgs-internal header (§F) when a support ticket resolves into a refund —
// it creates a PENDING refund for the finance console to approve.

import { HttpError, bodyStr, type AddRoute } from "../http";
import { insert } from "../db";
import { toCents } from "../util";
import {
  fundEscrow,
  startDisputeWindow,
  releaseEscrow,
  cancelEscrow,
  orderFinanceById,
  getConfig,
  isReasonCode,
  chargeFeaturedFee,
} from "../money";
import { tbGetOrder, tbGetAuction } from "../trailbase";

function logEvent(type: string, payload: Record<string, unknown>): void {
  insert(`INSERT INTO events_log(type, payload) VALUES(?, ?)`, [type, JSON.stringify(payload)]);
}

/** Backfill an order from TrailBase when an event arrives before order.paid. */
async function ensureFundedFromTrailbase(orderId: number): Promise<void> {
  if (orderFinanceById(orderId)) return;
  const order = await tbGetOrder(orderId).catch(() => null);
  if (!order || !order.paid_at) return;
  const paymentAmounts = await tbGetAuction(order.auction_id)
    .then((a) => ({ shipping: Number(a?.shipping_fee ?? 0) }))
    .catch(() => ({ shipping: 0 }));
  fundEscrow({
    orderId,
    buyer: String(order.buyer_username ?? ""),
    seller: String(order.seller_username ?? ""),
    itemPriceCents: toCents(Number(order.final_price ?? 0)),
    shippingCents: toCents(paymentAmounts.shipping),
    method: "backfill",
    reference: null,
    paidAt: order.paid_at,
    actor: "system:backfill",
  });
}

export function registerEventRoutes(on: AddRoute): void {
  on("POST", "/events", async (ctx) => {
    const type = bodyStr(ctx, "type", { required: true, max: 60 });
    const payload = ctx.body ?? {};
    logEvent(type, payload);

    if (type === "order.paid") {
      const orderId = Number(payload.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "orderId required", "bad_field");
      const created = fundEscrow({
        orderId,
        buyer: String(payload.buyer ?? ""),
        seller: String(payload.seller ?? ""),
        itemPriceCents: toCents(Number(payload.itemPrice ?? 0)),
        shippingCents: toCents(Number(payload.shipping ?? 0)),
        method: typeof payload.method === "string" ? payload.method : undefined,
        reference: typeof payload.reference === "string" ? payload.reference : null,
        actor: "system:engine",
      });
      return { ok: true, handled: "order.paid", created };
    }

    if (type === "order.delivered") {
      const orderId = Number(payload.orderId);
      if (!Number.isInteger(orderId)) throw new HttpError(400, "orderId required", "bad_field");
      await ensureFundedFromTrailbase(orderId);
      const opened = startDisputeWindow(orderId, typeof payload.deliveredAt === "string" ? payload.deliveredAt : null);
      return { ok: true, handled: "order.delivered", opened };
    }

    if (type === "order.dispute_window_elapsed") {
      const orderId = Number(payload.orderId);
      if (!Number.isInteger(orderId)) throw new HttpError(400, "orderId required", "bad_field");
      const released = releaseEscrow(orderId, "system:window_elapsed");
      return { ok: true, handled: "order.dispute_window_elapsed", released };
    }

    if (type === "order.cancelled") {
      const orderId = Number(payload.orderId);
      if (!Number.isInteger(orderId)) throw new HttpError(400, "orderId required", "bad_field");
      const cancelled = cancelEscrow(
        orderId,
        "system:engine",
        typeof payload.reason === "string" ? payload.reason : undefined,
      );
      return { ok: true, handled: "order.cancelled", cancelled };
    }

    if (type === "listing.featured") {
      // Gap-8: seller self-service featured listing (sell wizard checkbox).
      // Idempotent: balancedTx "feat-{auctionId}" guards double charges.
      const auctionId = Number(payload.auctionId);
      if (!Number.isInteger(auctionId) || auctionId <= 0) throw new HttpError(400, "auctionId required", "bad_field");
      const seller = String(payload.seller ?? "");
      if (!seller) throw new HttpError(400, "seller required", "bad_field");
      const auctionRef = String(payload.auctionRef ?? `auction #${auctionId}`).slice(0, 120);
      const charged = chargeFeaturedFee(seller, auctionRef, `feat-${auctionId}`);
      return { ok: true, handled: "listing.featured", charged, ref: `feat-${auctionId}` };
    }

    // Unknown event types are logged + acknowledged (engine is fire-and-forget).
    return { ok: true, handled: null };
  });

  on("POST", "/internal/refund", (ctx) => {
    ctx.requireInternal();
    const orderId = Number(ctx.body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "orderId required", "bad_field");
    const fin = orderFinanceById(orderId);
    if (!fin) throw new HttpError(400, "order is not in the finance system", "no_order_finance");
    const reasonCode = bodyStr(ctx, "reasonCode", { max: 40 }) || "goodwill";
    if (!isReasonCode(reasonCode)) throw new HttpError(400, "unknown reasonCode", "bad_reason");
    const cfg = getConfig();
    const gross = fin.item_price_cents + fin.shipping_cents;
    const maxAmount = fin.status === "holding" || fin.status === "partial" ? fin.escrow_cents : gross - fin.refunded_cents;
    const amountCents = Number(ctx.body?.amountCents) > 0 ? Math.round(Number(ctx.body?.amountCents)) : maxAmount;
    const kind = amountCents >= maxAmount ? "full" : "partial";
    const dual = amountCents > Math.round(cfg.dual_approval_threshold * 100);
    const id = insert(
      `INSERT INTO refunds(order_id, amount_cents, kind, reason_code, reason_note, status, requested_by, dual_approval)
       VALUES(?, ?, ?, ?, ?, 'pending_approval', ?, ?)`,
      [
        orderId,
        Math.min(amountCents, maxAmount),
        kind,
        reasonCode,
        typeof ctx.body?.reasonNote === "string" ? String(ctx.body.reasonNote).slice(0, 400) : null,
        typeof ctx.body?.requestedBy === "string" ? String(ctx.body.requestedBy).slice(0, 60) : "trust-service",
        dual ? 1 : 0,
      ],
    );
    logEvent("internal.refund", { refundId: id, orderId, amountCents });
    return { ok: true, refundId: id, status: "pending_approval" };
  });
}
