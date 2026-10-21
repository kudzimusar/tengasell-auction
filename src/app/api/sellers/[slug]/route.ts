// GET /api/sellers/[slug] — public shop page: profile + active listings + published reviews
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { round2 } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { requestId } = ctxFrom(req)
  const { slug } = await params

  const profile = await db.sellerProfile.findUnique({ where: { slug } })
  if (!profile) return fail("Shop not found", 404, requestId)
  const user = await db.user.findUnique({ where: { id: profile.userId } })
  if (!user || user.status === "DELETED") return fail("Shop not found", 404, requestId)

  const [listings, reviews, agg] = await Promise.all([
    db.listing.findMany({
      where: { sellerId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.review.findMany({
      where: { sellerId: user.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.review.aggregate({ where: { sellerId: user.id, status: "PUBLISHED" }, _avg: { rating: true }, _count: { id: true } }),
  ])

  const catIds = [...new Set(listings.map(l => l.categoryId))]
  const cats = catIds.length ? await db.category.findMany({ where: { id: { in: catIds } } }) : []
  const catMap = new Map(cats.map(c => [c.id, c]))

  const authorIds = [...new Set(reviews.map(r => r.authorId))]
  const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, avatarEmoji: true } }) : []
  const authorMap = new Map(authors.map(a => [a.id, a]))

  return ok({
    seller: {
      id: profile.id,
      userId: user.id,
      shopName: profile.shopName,
      slug: profile.slug,
      bio: profile.bio,
      status: profile.status,
      identityVerified: profile.identityVerified,
      businessVerified: profile.businessVerified,
      healthScore: profile.healthScore,
      ratingAvg: Math.round((agg._avg.rating ?? profile.ratingAvg) * 100) / 100,
      ratingCount: agg._count.id || profile.ratingCount,
      joinedAt: profile.joinedAt,
      city: user.city,
      avatarEmoji: user.avatarEmoji,
      userStatus: user.status,
    },
    listings: listings.map(l => {
      const c = catMap.get(l.categoryId)
      return {
        id: l.id,
        title: l.title,
        condition: l.condition,
        type: l.type,
        startingPrice: round2(l.startingPrice),
        buyNowPrice: l.buyNowPrice === null ? null : round2(l.buyNowPrice),
        currentPrice: round2(l.currentPrice),
        images: json(l.images, [] as string[]).slice(0, 1),
        status: l.status,
        endsAt: l.endsAt,
        bidCount: l.bidCount,
        watchCount: l.watchCount,
        category: c ? { slug: c.slug, name: c.name, nameJa: c.nameJa, icon: c.icon } : null,
        seller: { shopName: profile.shopName, slug: profile.slug, avatarEmoji: user.avatarEmoji, ratingAvg: Math.round((agg._avg.rating ?? 0) * 100) / 100 },
      }
    }),
    reviews: reviews.map(r => {
      const a = authorMap.get(r.authorId)
      return {
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        createdAt: r.createdAt,
        authorName: a?.name || "Buyer",
        authorEmoji: a?.avatarEmoji || "🙂",
        listingId: r.listingId,
      }
    }),
  }, requestId)
}
