// GET /api/v1/listings — public, governed listings search (bearer API key, read scope, rate limited)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { json } from "@/lib/server/api"
import { v1Auth, v1Json, v1Error, logV1Call, V1_PUBLIC_STATUSES } from "../_shared"
import { auctionAuthorityPayload, resolveLegacyAuctionBatch } from "@/lib/server/legacy-auction-convergence"

export const runtime = "nodejs"

// The Prisma schema intentionally keeps Listing free of relations; look up category/seller in bulk.
async function decorate(rows: Array<{ categoryId: string; sellerId: string }>) {
  const catIds = [...new Set(rows.map((r) => r.categoryId))]
  const sellerIds = [...new Set(rows.map((r) => r.sellerId))]
  const [cats, sellers] = await Promise.all([
    catIds.length ? db.category.findMany({ where: { id: { in: catIds } } }) : Promise.resolve([]),
    sellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : Promise.resolve([]),
  ])
  return {
    cat: new Map(cats.map((c) => [c.id, c])),
    seller: new Map(sellers.map((s) => [s.userId, s])),
  }
}

export async function GET(req: NextRequest) {
  const route = "/api/v1/listings"
  const auth = await v1Auth(req, route, "read")
  if (auth.error) return auth.error
  const { key, requestId, ip, startedAt } = auth

  const sp = req.nextUrl.searchParams
  const q = (sp.get("q") || "").trim().slice(0, 120)
  const category = sp.get("category") || undefined
  const type = sp.get("type") === "AUCTION" || sp.get("type") === "BUY_NOW" ? sp.get("type") : undefined
  const sort = sp.get("sort") || "newest"
  const limit = Math.min(Math.max(Number(sp.get("limit") || 20), 1), 50)
  const page = Math.max(Number(sp.get("page") || 1), 1)
  const skip = (page - 1) * limit

  try {
    const where: Record<string, unknown> = { status: { in: [...V1_PUBLIC_STATUSES] } }
    if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }]
    if (type) where.type = type
    if (category) {
      const cat = await db.category.findUnique({ where: { slug: category } })
      if (!cat) {
        const status = 404
        await logV1Call({ route, method: "GET", status, startedAt, requestId, ip, apiKeyId: key.id })
        return v1Error(`Unknown category '${category}'`, status, requestId)
      }
      where.categoryId = cat.id
    }

    const orderBy =
      sort === "ending"
        ? [{ endsAt: { sort: "asc" as const, nulls: "last" as const } }]
        : sort === "price_asc"
          ? { currentPrice: "asc" as const }
          : sort === "price_desc"
            ? { currentPrice: "desc" as const }
            : { publishedAt: { sort: "desc" as const, nulls: "last" as const } }

    const [rows, total] = await Promise.all([
      db.listing.findMany({ where, orderBy, skip, take: limit }),
      db.listing.count({ where }),
    ])

    const { cat, seller } = await decorate(rows)
    const auctionResolution = await resolveLegacyAuctionBatch(rows)

    const items = rows.map((r) => {
      const c = cat.get(r.categoryId)
      const s = seller.get(r.sellerId)
      const resolution = auctionResolution.get(r.id)
      const effective = resolution?.effective ?? {
        currentPrice: effective.currentPrice,
        status: effective.status,
        endsAt: effective.endsAt,
        bidCount: effective.bidCount,
      }
      return {
        id: r.id,
        title: r.title,
        condition: r.condition,
        type: r.type,
        currentPrice: r.currentPrice,
        buyNowPrice: r.buyNowPrice,
        status: r.status,
        endsAt: r.endsAt,
        bidCount: r.bidCount,
        watchCount: r.watchCount,
        category: c ? { slug: c.slug, name: c.name } : null,
        seller: s ? { shopName: s.shopName, slug: s.slug, ratingAvg: s.ratingAvg } : null,
        images: json<string[]>(r.images, []),
        auctionAuthority: r.type === "AUCTION" && resolution ? auctionAuthorityPayload(resolution) : undefined,
      }
    })

    await logV1Call({ route, method: "GET", status: 200, startedAt, requestId, ip, apiKeyId: key.id })
    return v1Json({ ok: true, data: { items, total, page, limit }, requestId }, requestId)
  } catch (e) {
    await logV1Call({ route, method: "GET", status: 500, startedAt, requestId, ip, apiKeyId: key.id })
    return v1Error("Internal server error", 500, requestId)
  }
}
