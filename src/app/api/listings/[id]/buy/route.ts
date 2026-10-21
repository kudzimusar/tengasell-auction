// POST /api/listings/[id]/buy — BUY_NOW checkout start: creates Order PENDING_PAYMENT + Payment AUTHORIZED (transaction),
// decrements stock. Capture (PAID + ledger + tax + invoice + notify + email + webhook) happens on PATCH /api/orders/[id] action "pay",
// keeping one UX step in the client (buy → pay immediately).
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, sha256 } from "@/lib/server/auth-core"
import { flagEnabled, getSettings, calcFees, round2 } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

const buySchema = z.object({
  method: z.enum(["MOCK_CARD", "MOCK_WALLET", "MOCK_ECOCASH"]).default("MOCK_CARD"),
  shippingAddress: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(30),
    city: z.string().trim().min(2).max(80),
    street: z.string().trim().min(2).max(200),
    notes: z.string().trim().max(500).optional(),
  }),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in to buy", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)

  if (await flagEnabled("payments.maintenance", false)) {
    return fail("Payments are under maintenance — please try again shortly", 503, requestId)
  }
  if (!(await flagEnabled("buy_now.enabled", true))) {
    return fail("Buy-now checkout is temporarily disabled", 503, requestId)
  }

  const { data, error: bodyErr } = await parseBody(req, buySchema)
  if (bodyErr) return bodyErr

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return fail("Listing not found", 404, requestId)
  if (listing.type !== "BUY_NOW") return fail("This item is sold by auction — place a bid instead", 409, requestId)
  if (listing.status !== "ACTIVE") return fail("This item is no longer available", 409, requestId)
  if (listing.sellerId === user.id) return fail("You cannot buy your own listing", 409, requestId)
  if (listing.stock <= 0) return fail("Sold out", 409, requestId)

  const unitPrice = round2(listing.buyNowPrice ?? listing.startingPrice)
  if (unitPrice <= 0) return fail("Invalid price", 422, requestId)

  const settings = await getSettings()
  const fees = calcFees(unitPrice, settings)
  const idempotencyKey = sha256(`${listing.id}:${user.id}:${Date.now()}`)
  const now = new Date()

  try {
    const { orderId } = await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          listingId: listing.id,
          buyerId: user.id,
          sellerId: listing.sellerId,
          type: "BUY_NOW",
          amount: unitPrice,
          buyerFee: fees.buyerFee,
          sellerFee: fees.sellerFee,
          vatAmount: fees.vat,
          totalCharged: fees.totalCharged,
          status: "PENDING_PAYMENT",
          shippingAddress: JSON.stringify(data.shippingAddress),
        },
      })
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: data.method,
          status: "AUTHORIZED",
          authRef: `auth_${idempotencyKey.slice(0, 12)}`,
          amount: fees.totalCharged,
          idempotencyKey,
        },
      })
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "PLACED", actorId: user.id, data: JSON.stringify({ listingId: listing.id, amount: unitPrice, method: data.method }) },
      })
      const newStock = Math.max(listing.stock - 1, 0)
      await tx.listing.update({
        where: { id: listing.id },
        data: newStock <= 0 ? { stock: 0, status: "SOLD", endedAt: now } : { stock: newStock },
      })
      return { orderId: order.id }
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: "order.buy", targetType: "ORDER", targetId: orderId,
      after: { listingId: listing.id, amount: unitPrice, status: "PENDING_PAYMENT", method: data.method, shippingAddress: data.shippingAddress },
      requestId, ip,
    })
    return ok({ orderId, amount: unitPrice, fees, status: "PENDING_PAYMENT" }, requestId, 201)
  } catch {
    return fail("Checkout failed — please retry", 500, requestId)
  }
}
