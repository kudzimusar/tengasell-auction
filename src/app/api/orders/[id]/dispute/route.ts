// POST /api/orders/[id]/dispute — buyer opens a dispute on a PAID..DELIVERED order
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"
import { notify, sendTemplatedEmail } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

const disputeSchema = z.object({
  reason: z.enum(["ITEM_NOT_AS_DESCRIBED", "NOT_RECEIVED", "OTHER"]),
  details: z.string().trim().min(10).max(2000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401 || !user) return fail("Sign in required", 401, requestId)

  const { data, error: bodyErr } = await parseBody(req, disputeSchema)
  if (bodyErr) return bodyErr

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail("Order not found", 404, requestId)
  if (order.buyerId !== user.id) return fail("Only the buyer can open a dispute", 403, requestId)
  if (!["PAID", "SHIPPED", "DELIVERED"].includes(order.status)) {
    return fail("Disputes can be opened on paid, shipped or delivered orders", 409, requestId)
  }
  const existing = await db.dispute.findFirst({ where: { orderId: order.id, status: { in: ["OPEN", "UNDER_REVIEW"] } } })
  if (existing) return fail("A dispute is already open for this order", 409, requestId)

  const now = new Date()
  try {
    const dispute = await db.$transaction(async (tx) => {
      const d = await tx.dispute.create({
        data: { orderId: order.id, openedBy: user.id, reason: data.reason, details: data.details, status: "OPEN" },
      })
      await tx.order.update({ where: { id: order.id }, data: { status: "DISPUTED" } })
      await tx.orderEvent.create({ data: { orderId: order.id, type: "DISPUTE_OPENED", actorId: user.id, data: JSON.stringify({ disputeId: d.id, reason: data.reason }) } })
      return d
    })

    const [listing, seller] = await Promise.all([
      db.listing.findUnique({ where: { id: order.listingId } }),
      db.user.findUnique({ where: { id: order.sellerId } }),
    ])
    if (seller) {
      await notify(seller.id, "DISPUTE_OPENED", { orderId: order.id, title: listing?.title, reason: data.reason, disputeId: dispute.id })
      await sendTemplatedEmail({
        templateKey: "dispute_opened",
        toUser: seller,
        vars: { name: seller.name, orderId: order.id.slice(-6), title: listing?.title || "" },
        fallbackSubject: `Dispute opened on order ${order.id.slice(-6)}`,
        fallbackBody: "A dispute was opened on one of your orders. Our team will mediate within 24h.",
      })
    }
    await audit({
      actorId: user.id, actorRole: user.role, action: "order.dispute", targetType: "ORDER", targetId: order.id,
      after: { disputeId: dispute.id, reason: data.reason, status: "OPEN" }, requestId, ip,
    })
    return ok({ id: dispute.id, status: "OPEN", orderStatus: "DISPUTED" }, requestId, 201)
  } catch {
    return fail("Could not open dispute", 500, requestId)
  }
}
