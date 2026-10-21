// GET /api/watch — my watchlist (listings + current price + seller), newest watches first
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

  const watches = await db.watch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 })
  const listingIds = watches.map(w => w.listingId)
  const rows = listingIds.length ? await db.listing.findMany({ where: { id: { in: listingIds } } }) : []

  const sellerIds = [...new Set(rows.map(r => r.sellerId))]
  const [users, profiles] = await Promise.all([
    sellerIds.length ? db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, avatarEmoji: true } }) : [],
    sellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : [],
  ])
  const userMap = new Map(users.map(u => [u.id, u]))
  const profMap = new Map(profiles.map(p => [p.userId, p]))

  const watchMap = new Map(watches.map(w => [w.listingId, w.createdAt]))
  const items = rows.map(l => {
    const u = userMap.get(l.sellerId)
    const p = profMap.get(l.sellerId)
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
      watchedAt: watchMap.get(l.id) || l.createdAt,
      seller: { shopName: p?.shopName || u?.name || "Seller", slug: p?.slug || null, avatarEmoji: u?.avatarEmoji || "🙂" },
    }
  })
  return ok({ items }, requestId)
}
