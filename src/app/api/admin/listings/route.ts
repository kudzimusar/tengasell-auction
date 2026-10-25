// GET /api/admin/listings — all statuses, searchable (MODERATOR+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate, json } from "@/lib/server/api"
import { guard, MOD_PLUS } from "../_lib/ctl"
import { auctionAuthorityPayload, resolveLegacyAuctionBatch } from "@/lib/server/legacy-auction-convergence"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined
  const q = (sp.get("q") || "").trim().slice(0, 120)

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  if (q) where.OR = [{ title: { contains: q } }, { description: { contains: q } }]

  try {
    const [rows, total] = await Promise.all([
      db.listing.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.listing.count({ where }),
    ])

    const sellerIds = [...new Set(rows.map((r) => r.sellerId))]
    const categoryIds = [...new Set(rows.map((r) => r.categoryId))]
    const [owners, profiles, cats] = await Promise.all([
      sellerIds.length ? db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, email: true } }) : [],
      sellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : [],
      categoryIds.length ? db.category.findMany({ where: { id: { in: categoryIds } } }) : [],
    ])
    const ownerMap = new Map(owners.map((o) => [o.id, o]))
    const profMap = new Map(profiles.map((p) => [p.userId, p]))
    const catMap = new Map(cats.map((c) => [c.id, c]))
    const auctionResolution = await resolveLegacyAuctionBatch(rows)

    const items = rows.map((l) => {
      const owner = ownerMap.get(l.sellerId)
      const p = profMap.get(l.sellerId)
      const c = catMap.get(l.categoryId)
      const resolution = auctionResolution.get(l.id)
      const effective = resolution?.effective ?? {
        currentPrice: l.currentPrice,
        status: l.status,
        endsAt: l.endsAt,
        bidCount: l.bidCount,
      }
      return {
        id: l.id, title: l.title, status: effective.status, legacyStatus: l.status, type: l.type, condition: l.condition,
        currentPrice: effective.currentPrice, startingPrice: l.startingPrice, buyNowPrice: l.buyNowPrice,
        rejectReason: l.rejectReason, version: l.version,
        bidCount: effective.bidCount, watchCount: l.watchCount, viewCount: l.viewCount,
        endsAt: effective.endsAt, publishedAt: l.publishedAt, createdAt: l.createdAt,
        category: c ? `${c.icon} ${c.name}` : "—",
        images: json(l.images, [] as string[]),
        description: l.description.slice(0, 400),
        seller: {
          id: l.sellerId, name: owner?.name || "—", email: owner?.email || "",
          shopName: p?.shopName || owner?.name || "Seller", slug: p?.slug || null,
        },
        auctionAuthority: l.type === "AUCTION" && resolution ? auctionAuthorityPayload(resolution) : undefined,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
