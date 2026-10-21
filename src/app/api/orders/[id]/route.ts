// GET  /api/orders/[id] — full detail (buyer/seller/staff)
// PATCH /api/orders/[id] — lifecycle state machine: pay | ship | confirm | complete | cancel (role-checked)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { captureOrderPayment, flagEnabled, notify, round2, sendTemplatedEmail } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

// ── GET ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401 || !user) return fail("Sign in required", 401, requestId)

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail("Order not found", 404, requestId)

  const isBuyer = order.buyerId === user.id
  const isSeller = order.sellerId === user.id
  const isStaff = STAFF_ROLES.includes(user.role as never)
  if (!isBuyer && !isSeller && !isStaff) return fail("Not your order", 403, requestId)

  const [listing, events, dispute, review, payment, invoice] = await Promise.all([
    db.listing.findUnique({ where: { id: order.listingId } }),
    db.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
    db.dispute.findFirst({ where: { orderId: order.id }, orderBy: { openedAt: "desc" } }),
    db.review.findUnique({ where: { orderId: order.id } }),
    db.payment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } }),
    db.invoice.findFirst({ where: { orderId: order.id } }),
  ])

  return ok({
    order: {
      id: order.id,
      listingId: order.listingId,
      listingTitle: listing?.title || "Listing removed",
      listingImages: listing ? json(listing.images, [] as string[]).slice(0, 1) : [],
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      type: order.type,
      amount: round2(order.amount),
      buyerFee: round2(order.buyerFee),
      sellerFee: round2(order.sellerFee),
      vatAmount: round2(order.vatAmount),
      totalCharged: round2(order.totalCharged),
      status: order.status,
      paymentMethod: order.paymentMethod,
      shippingAddress: json(order.shippingAddress, null as { name?: string; city?: string } | null),
      trackingCode: order.trackingCode,
      carrier: order.carrier,
      placedAt: order.placedAt,
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
    },
    viewer: { isBuyer, isSeller, isStaff },
    events: events.map(e => ({ id: e.id, type: e.type, actorId: e.actorId, data: json(e.data, {}), createdAt: e.createdAt })),
    dispute: dispute ? { id: dispute.id, reason: dispute.reason, details: dispute.details, status: dispute.status, openedAt: dispute.openedAt } : null,
    review: review ? { id: review.id, rating: review.rating, title: review.title, body: review.body, createdAt: review.createdAt } : null,
    payment: payment ? { id: payment.id, method: payment.method, status: payment.status, amount: round2(payment.amount) } : null,
    invoice: invoice ? { id: invoice.id, number: invoice.number, total: round2(invoice.total), vatAmount: round2(invoice.vatAmount) } : null,
  }, requestId)
}

// ── PATCH — lifecycle actions ───────────────────────────────────
const patchSchema = z.object({
  action: z.enum(["pay", "ship", "confirm", "complete", "cancel"]),
  method: z.enum(["MOCK_CARD", "MOCK_WALLET", "MOCK_ECOCASH"]).optional(),
  shippingAddress: z
    .object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(5).max(30),
      city: z.string().trim().min(2).max(80),
      street: z.string().trim().min(2).max(200),
      notes: z.string().trim().max(500).optional(),
    })
    .optional(),
  carrier: z.string().trim().min(2).max(60).optional(),
  trackingCode: z.string().trim().min(3).max(60).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401 || !user) return fail("Sign in required", 401, requestId)

  const { data, error: bodyErr } = await parseBody(req, patchSchema)
  if (bodyErr) return bodyErr

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail("Order not found", 404, requestId)
  const isBuyer = order.buyerId === user.id
  const isSeller = order.sellerId === user.id

  const now = new Date()

  // ── buyer pays: PENDING_PAYMENT → PAID (capture pipeline: ledger + tax + invoice + notify + email + webhook)
  if (data.action === "pay") {
    if (!isBuyer) return fail("Only the buyer can pay this order", 403, requestId)
    if (await flagEnabled("payments.maintenance", false)) {
      return fail("Payments are under maintenance — please try again shortly", 503, requestId)
    }
    if (data.shippingAddress) {
      await db.order.update({ where: { id: order.id }, data: { shippingAddress: JSON.stringify(data.shippingAddress) } })
    }
    const res = await captureOrderPayment({ orderId: order.id, method: data.method, actorId: user.id, actorRole: user.role, requestId, ip })
    if (!res.ok) return fail(res.error, res.code, requestId)
    return ok({ status: res.order.status, totalCharged: res.order.totalCharged }, requestId)
  }

  // ── seller ships: PAID → SHIPPED
  if (data.action === "ship") {
    if (!isSeller) return fail("Only the seller can ship this order", 403, requestId)
    if (order.status !== "PAID") return fail("Order must be PAID before shipping", 409, requestId)
    if (!data.carrier || !data.trackingCode) return fail("Carrier and tracking code are required", 422, requestId)

    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "SHIPPED", shippedAt: now, carrier: data.carrier, trackingCode: data.trackingCode } })
      await tx.orderEvent.create({ data: { orderId: order.id, type: "SHIPPED", actorId: user.id, data: JSON.stringify({ carrier: data.carrier, trackingCode: data.trackingCode }) } })
    })

    const [listing, buyer] = await Promise.all([
      db.listing.findUnique({ where: { id: order.listingId } }),
      db.user.findUnique({ where: { id: order.buyerId } }),
    ])
    if (buyer) {
      await notify(buyer.id, "SHIP", { orderId: order.id, title: listing?.title, trackingCode: data.trackingCode, carrier: data.carrier })
      await sendTemplatedEmail({
        templateKey: "order_shipped",
        toUser: buyer,
        vars: { name: buyer.name, title: listing?.title || "your order", tracking: `${data.carrier} ${data.trackingCode}` },
        fallbackSubject: "Your order has shipped",
        fallbackBody: `Good news — "${listing?.title || "your order"}" is on its way. Tracking: ${data.carrier} ${data.trackingCode}`,
      })
    }
    await audit({ actorId: user.id, actorRole: user.role, action: "order.ship", targetType: "ORDER", targetId: order.id, before: { status: order.status }, after: { status: "SHIPPED", carrier: data.carrier, trackingCode: data.trackingCode }, requestId, ip })
    return ok({ status: "SHIPPED" }, requestId)
  }

  // ── buyer confirms delivery: SHIPPED/DELIVERED → DELIVERED
  if (data.action === "confirm") {
    if (!isBuyer) return fail("Only the buyer can confirm delivery", 403, requestId)
    if (order.status !== "SHIPPED" && order.status !== "DELIVERED") return fail("Order must be SHIPPED to confirm delivery", 409, requestId)
    if (order.status === "DELIVERED") return ok({ status: "DELIVERED" }, requestId)
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredAt: now, proofOfDelivery: JSON.stringify({ deliveredAt: now, note: "Buyer confirmed via marketplace" }) } })
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DELIVERED", actorId: user.id, data: JSON.stringify({ confirmedBy: "buyer" }) } })
    })
    await audit({ actorId: user.id, actorRole: user.role, action: "order.confirm", targetType: "ORDER", targetId: order.id, before: { status: order.status }, after: { status: "DELIVERED" }, requestId, ip })
    return ok({ status: "DELIVERED" }, requestId)
  }

  // ── buyer completes: DELIVERED → COMPLETED (releases review rights)
  if (data.action === "complete") {
    if (!isBuyer) return fail("Only the buyer can complete the order", 403, requestId)
    if (order.status !== "DELIVERED") return fail("Confirm delivery before completing the order", 409, requestId)
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "COMPLETED", completedAt: now } })
      await tx.orderEvent.create({ data: { orderId: order.id, type: "COMPLETED", actorId: user.id, data: JSON.stringify({ note: "Buyer completed the order" }) } })
    })
    await notify(order.sellerId, "ORDER", { orderId: order.id, title: "Order completed", side: "seller", completed: true })
    await audit({ actorId: user.id, actorRole: user.role, action: "order.complete", targetType: "ORDER", targetId: order.id, before: { status: order.status }, after: { status: "COMPLETED" }, requestId, ip })
    return ok({ status: "COMPLETED" }, requestId)
  }

  // ── buyer cancels: PENDING_PAYMENT → CANCELLED (stock restored)
  if (data.action === "cancel") {
    if (!isBuyer) return fail("Only the buyer can cancel this order", 403, requestId)
    if (order.status !== "PENDING_PAYMENT") return fail("Only unpaid orders can be cancelled", 409, requestId)
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelledAt: now } })
      await tx.orderEvent.create({ data: { orderId: order.id, type: "CANCELLED", actorId: user.id, data: JSON.stringify({ by: "buyer" }) } })
      if (order.type === "BUY_NOW") {
        const listing = await tx.listing.findUnique({ where: { id: order.listingId } })
        if (listing) {
          const restored = listing.stock + 1
          await tx.listing.update({
            where: { id: listing.id },
            data: listing.status === "SOLD" && listing.buyNowPrice !== null ? { stock: restored, status: "ACTIVE", endedAt: null } : { stock: restored },
          })
        }
      }
      // Release the hold on any authorized (uncaptured) mock payment
      await tx.payment.updateMany({ where: { orderId: order.id, status: "AUTHORIZED" }, data: { status: "FAILED", updatedAt: now } })
    })
    await audit({ actorId: user.id, actorRole: user.role, action: "order.cancel", targetType: "ORDER", targetId: order.id, before: { status: order.status }, after: { status: "CANCELLED" }, requestId, ip })
    return ok({ status: "CANCELLED" }, requestId)
  }

  return fail("Unknown action", 400, requestId)
}
