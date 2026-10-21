// GET /api/orders — my orders (buyer or seller side), enriched with listing snapshot, dispute, review, events summary
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"
import { round2 } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401 || !user) return fail("Sign in required", 401, requestId)

  const side = req.nextUrl.searchParams.get("side") === "selling" ? "selling" : "buying"
  const orders = await db.order.findMany({
    where: side === "buying" ? { buyerId: user.id } : { sellerId: user.id },
    orderBy: { placedAt: "desc" },
    take: 50,
  })

  const listingIds = [...new Set(orders.map(o => o.listingId))]
  const [listings, disputes, reviews, events] = await Promise.all([
    listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds } } }) : [],
    db.dispute.findMany({ where: { orderId: { in: orders.map(o => o.id) } } }),
    db.review.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, select: { orderId: true, id: true } }),
    db.orderEvent.findMany({ where: { orderId: { in: orders.map(o => o.id) } }, orderBy: { createdAt: "asc" } }),
  ])
  const listingMap = new Map(listings.map(l => [l.id, l]))
  const disputeMap = new Map(disputes.map(d => [d.orderId, d]))
  const reviewSet = new Set(reviews.map(r => r.orderId))
  const eventsByOrder = new Map<string, typeof events>()
  for (const e of events) {
    const arr = eventsByOrder.get(e.orderId) || []
    arr.push(e)
    eventsByOrder.set(e.orderId, arr)
  }

  const items = orders.map(o => {
    const l = listingMap.get(o.listingId)
    const evts = eventsByOrder.get(o.id) || []
    const last = evts[evts.length - 1]
    const d = disputeMap.get(o.id)
    return {
      id: o.id,
      listingId: o.listingId,
      listingTitle: l?.title || "Listing removed",
      listingImages: l ? json(l.images, [] as string[]).slice(0, 1) : [],
      listingStatus: l?.status || null,
      type: o.type,
      amount: round2(o.amount),
      buyerFee: round2(o.buyerFee),
      sellerFee: round2(o.sellerFee),
      vatAmount: round2(o.vatAmount),
      totalCharged: round2(o.totalCharged),
      status: o.status,
      paymentMethod: o.paymentMethod,
      trackingCode: o.trackingCode,
      carrier: o.carrier,
      shippingAddress: json(o.shippingAddress, null as { name: string } | null),
      placedAt: o.placedAt,
      paidAt: o.paidAt,
      shippedAt: o.shippedAt,
      deliveredAt: o.deliveredAt,
      completedAt: o.completedAt,
      role: side === "buying" ? (o.buyerId === user.id ? "buyer" : "seller") : "seller",
      counterpartId: side === "buying" ? o.sellerId : o.buyerId,
      eventCount: evts.length,
      lastEventType: last?.type || null,
      lastEventAt: last?.createdAt || null,
      dispute: d ? { id: d.id, status: d.status, reason: d.reason } : null,
      hasReview: reviewSet.has(o.id),
    }
  })
  return ok({ items, side }, requestId)
}
