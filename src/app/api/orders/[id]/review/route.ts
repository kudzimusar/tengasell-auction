// POST /api/orders/[id]/review — buyer reviews a COMPLETED order (one per order), recomputes seller rating
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
})

// Profanity-lite filter: masks a small blocklist rather than rejecting (T&S reviews can hide later)
const BAD_WORDS = ["fuck", "shit", "bastard", "scam artist"]
function profanityLite(s: string): string {
  let out = s
  for (const w of BAD_WORDS) out = out.replace(new RegExp(w, "gi"), "*".repeat(w.length))
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401 || !user) return fail("Sign in required", 401, requestId)

  const { data, error: bodyErr } = await parseBody(req, reviewSchema)
  if (bodyErr) return bodyErr

  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail("Order not found", 404, requestId)
  if (order.buyerId !== user.id) return fail("Only the buyer can review this order", 403, requestId)
  if (order.status !== "COMPLETED") return fail("You can review after the order is completed", 409, requestId)

  const existing = await db.review.findUnique({ where: { orderId: order.id } })
  if (existing) return fail("This order has already been reviewed", 409, requestId)

  const title = data.title ? profanityLite(data.title) : undefined
  const body = data.body ? profanityLite(data.body) : undefined

  try {
    const review = await db.review.create({
      data: {
        orderId: order.id,
        listingId: order.listingId,
        authorId: user.id,
        sellerId: order.sellerId,
        rating: data.rating,
        title,
        body,
        status: "PUBLISHED",
      },
    })

    // Recompute seller aggregates from published reviews (audit trail = aggregate from source)
    const agg = await db.review.aggregate({ where: { sellerId: order.sellerId, status: "PUBLISHED" }, _avg: { rating: true }, _count: { id: true } })
    await db.sellerProfile.updateMany({
      where: { userId: order.sellerId },
      data: { ratingAvg: Math.round((agg._avg.rating || 0) * 100) / 100, ratingCount: agg._count.id },
    })
    // Listing-level rating for item pages
    const lAgg = await db.review.aggregate({ where: { listingId: order.listingId, status: "PUBLISHED" }, _avg: { rating: true } })
    await db.listing.updateMany({ where: { id: order.listingId }, data: { ratingAvg: Math.round((lAgg._avg.rating || 0) * 100) / 100 } })

    await audit({
      actorId: user.id, actorRole: user.role, action: "order.review", targetType: "ORDER", targetId: order.id,
      after: { reviewId: review.id, rating: review.rating, sellerRatingAvg: agg._avg.rating, sellerRatingCount: agg._count.id },
      requestId, ip,
    })
    return ok({ id: review.id, rating: review.rating, status: review.status, sellerRatingAvg: agg._avg.rating, sellerRatingCount: agg._count.id }, requestId, 201)
  } catch {
    return fail("Could not save review", 500, requestId)
  }
}
