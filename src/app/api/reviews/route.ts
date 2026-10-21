// GET /api/reviews?listingId= | ?sellerUserId= — published reviews (public)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const sp = req.nextUrl.searchParams
  const listingId = sp.get("listingId")
  const sellerUserId = sp.get("sellerUserId")
  if (!listingId && !sellerUserId) return fail("Provide listingId or sellerUserId", 400, requestId)

  const where = listingId
    ? { listingId, status: "PUBLISHED" }
    : { sellerId: sellerUserId!, status: "PUBLISHED" }

  const reviews = await db.review.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 })
  const authorIds = [...new Set(reviews.map(r => r.authorId))]
  const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, avatarEmoji: true } }) : []
  const authorMap = new Map(authors.map(a => [a.id, a]))

  const items = reviews.map(r => {
    const a = authorMap.get(r.authorId)
    return {
      id: r.id,
      orderId: r.orderId,
      listingId: r.listingId,
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      authorId: r.authorId,
      authorName: a?.name || "Buyer",
      authorEmoji: a?.avatarEmoji || "🙂",
      sellerId: r.sellerId,
    }
  })
  return ok({ items }, requestId)
}
