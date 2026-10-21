// GET /api/admin/orders/[id] — full detail: events, payment, refunds, dispute (SUPPORT+FINANCE; no mutations)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { guard, ORDER_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(ORDER_ROLES, requestId)
  if (!user) return res
  const { id } = await params

  try {
    const order = await db.order.findUnique({ where: { id } })
    if (!order) return fail("Order not found", 404, requestId)

    const [events, payment, refunds, dispute, invoice] = await Promise.all([
      db.orderEvent.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } }),
      db.payment.findFirst({ where: { orderId: id }, orderBy: { createdAt: "desc" } }),
      db.refund.findMany({ where: { orderId: id }, orderBy: { createdAt: "desc" } }),
      db.dispute.findFirst({ where: { orderId: id }, orderBy: { openedAt: "desc" } }),
      db.invoice.findFirst({ where: { orderId: id } }),
    ])

    const [buyer, seller, listing] = await Promise.all([
      db.user.findUnique({ where: { id: order.buyerId }, select: { id: true, name: true, email: true } }),
      db.user.findUnique({ where: { id: order.sellerId }, select: { id: true, name: true, email: true } }),
      db.listing.findUnique({ where: { id: order.listingId } }),
    ])
    const sellerProfile = await db.sellerProfile.findUnique({ where: { userId: order.sellerId } })

    return ok({
      order: {
        ...order,
        shippingAddress: json(order.shippingAddress, null as unknown),
        proofOfDelivery: json(order.proofOfDelivery, null as unknown),
      },
      buyer, seller: seller ? { ...seller, shopName: sellerProfile?.shopName || null } : null,
      listing: listing ? { id: listing.id, title: listing.title, type: listing.type, status: listing.status } : null,
      events: events.map((e) => ({ ...e, data: json(e.data, {} as Record<string, unknown>) })),
      payment,
      refunds,
      dispute: dispute || null,
      invoice: invoice || null,
    }, requestId)
  } catch {
    return fail("Could not load order", 500, requestId)
  }
}
