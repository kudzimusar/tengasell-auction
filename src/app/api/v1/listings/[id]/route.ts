// GET /api/v1/listings/[id] — public, governed listing detail + top 10 anonymised bids
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { json } from "@/lib/server/api"
import { v1Auth, v1Json, v1Error, logV1Call, V1_PUBLIC_STATUSES } from "../../_shared"

export const runtime = "nodejs"

const maskBidder = (handle: string | null | undefined) =>
  handle && handle.length > 1 ? `${handle.slice(0, 2)}${"*".repeat(3)}` : "b***"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const route = `/api/v1/listings/${id}`
  const auth = await v1Auth(req, route, "read")
  if (auth.error) return auth.error
  const { key, requestId, ip, startedAt } = auth

  try {
    const listing = await db.listing.findUnique({ where: { id } })

    if (!listing || !(V1_PUBLIC_STATUSES as readonly string[]).includes(listing.status)) {
      const status = 404
      await logV1Call({ route, method: "GET", status, startedAt, requestId, ip, apiKeyId: key.id })
      return v1Error("Listing not found or not publicly visible", status, requestId)
    }

    // Top 10 bids by amount — bidder identity masked, never exposed
    const [bids, category, sellerProfile] = await Promise.all([
      db.bid.findMany({ where: { listingId: id }, orderBy: [{ amount: "desc" }, { createdAt: "asc" }], take: 10 }),
      db.category.findUnique({ where: { id: listing.categoryId } }),
      db.sellerProfile.findUnique({ where: { userId: listing.sellerId } }),
    ])
    const bidders = await db.user.findMany({
      where: { id: { in: [...new Set(bids.map((b) => b.bidderId))] } },
      select: { id: true, handle: true },
    })
    const bidderMap = new Map(bidders.map((u) => [u.id, u.handle]))

    const detail = {
      id: listing.id,
      title: listing.title,
      titleJa: listing.titleJa,
      description: listing.description,
      condition: listing.condition,
      type: listing.type,
      startingPrice: listing.startingPrice,
      currentPrice: listing.currentPrice,
      buyNowPrice: listing.buyNowPrice,
      stock: listing.stock,
      status: listing.status,
      endsAt: listing.endsAt,
      bidCount: listing.bidCount,
      watchCount: listing.watchCount,
      viewCount: listing.viewCount,
      images: json<string[]>(listing.images, []),
      category: category ? { slug: category.slug, name: category.name } : null,
      seller: sellerProfile
        ? { shopName: sellerProfile.shopName, slug: sellerProfile.slug, ratingAvg: sellerProfile.ratingAvg }
        : null,
      publishedAt: listing.publishedAt,
      createdAt: listing.createdAt,
      bids: bids.map((b) => ({
        amount: b.amount,
        createdAt: b.createdAt,
        bidder: maskBidder(bidderMap.get(b.bidderId)),
      })),
    }

    await logV1Call({ route, method: "GET", status: 200, startedAt, requestId, ip, apiKeyId: key.id })
    return v1Json({ ok: true, data: detail, requestId }, requestId)
  } catch (e) {
    await logV1Call({ route, method: "GET", status: 500, startedAt, requestId, ip, apiKeyId: key.id })
    return v1Error("Internal server error", 500, requestId)
  }
}
