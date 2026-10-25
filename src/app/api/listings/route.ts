// /api/listings — GET: public search/browse (+ ?mine=1 own listings) · POST: seller creates (moderation queue)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, rateLimit, STAFF_ROLES } from "@/lib/server/auth-core"
import { PUBLIC_LISTING_STATUSES, getSettings, flagEnabled, notify, round2 } from "@/app/api/listings/shared/mkt"
import { AUCTION_AUTHORITY_ERRORS, authorityDetails, isLegacyPrismaAuction } from "@/lib/auction-authority"

export const runtime = "nodejs"

// ── GET /api/listings?q&category&status&type&sort&page&limit[&mine=1] ──
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const sp = req.nextUrl.searchParams
  const mine = sp.get("mine") === "1"

  const limit = Math.min(Math.max(Number(sp.get("limit") || 20), 1), 50)
  const page = Math.max(Number(sp.get("page") || 1), 1)
  const skip = (page - 1) * limit

  const q = (sp.get("q") || "").trim().slice(0, 120)
  const category = sp.get("category") || undefined
  const type = sp.get("type") === "AUCTION" || sp.get("type") === "BUY_NOW" ? sp.get("type") : undefined
  const sort = sp.get("sort") || "newest"
  const statusParam = sp.get("status") || "ACTIVE"

  let sessionUser: Awaited<ReturnType<typeof requireUser>>["user"] = null
  if (mine) {
    const { user } = await requireUser()
    if (!user) return fail("Sign in required", 401, requestId)
    sessionUser = user
  }

  // Visibility: non-owners only ever see public statuses. mine=1 → any status of my own listings.
  const statusWhere = mine
    ? { sellerId: sessionUser!.id }
    : statusParam === "PUBLIC"
      ? { status: { in: [...PUBLIC_LISTING_STATUSES] } }
      : { status: (PUBLIC_LISTING_STATUSES as readonly string[]).includes(statusParam) ? statusParam : "ACTIVE" }

  const where: Record<string, unknown> = { ...statusWhere }
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }
  if (type) where.type = type
  if (category) {
    const cat = await db.category.findUnique({ where: { slug: category } })
    if (!cat) return ok({ items: [], total: 0, page, limit }, requestId)
    where.categoryId = cat.id
  }

  const orderBy =
    sort === "ending"
      ? [{ endsAt: { sort: "asc" as const, nulls: "last" as const } }, { createdAt: "desc" as const }]
      : sort === "price_asc"
        ? { currentPrice: "asc" as const }
        : sort === "price_desc"
          ? { currentPrice: "desc" as const }
          : { createdAt: "desc" as const }

  try {
    const [rows, total] = await Promise.all([
      db.listing.findMany({ where, orderBy, skip, take: limit }),
      db.listing.count({ where }),
    ])

    // Manual joins (schema has no relations)
    const sellerIds = [...new Set(rows.map(r => r.sellerId))]
    const categoryIds = [...new Set(rows.map(r => r.categoryId))]
    const [users, profiles, cats] = await Promise.all([
      sellerIds.length ? db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, avatarEmoji: true } }) : [],
      sellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : [],
      categoryIds.length ? db.category.findMany({ where: { id: { in: categoryIds } } }) : [],
    ])
    const userMap = new Map(users.map(u => [u.id, u]))
    const profMap = new Map(profiles.map(p => [p.userId, p]))
    const catMap = new Map(cats.map(c => [c.id, c]))

    const items = rows.map(l => {
      const u = userMap.get(l.sellerId)
      const p = profMap.get(l.sellerId)
      const c = catMap.get(l.categoryId)
      return {
        id: l.id,
        title: l.title,
        description: l.description.slice(0, 280),
        condition: l.condition,
        type: l.type,
        startingPrice: round2(l.startingPrice),
        buyNowPrice: l.buyNowPrice === null ? null : round2(l.buyNowPrice),
        currentPrice: round2(l.currentPrice),
        stock: l.stock,
        images: json(l.images, [] as string[]).slice(0, 4),
        status: l.status,
        rejectReason: mine && sessionUser?.id === l.sellerId ? l.rejectReason : undefined,
        endsAt: l.endsAt,
        viewCount: l.viewCount,
        bidCount: l.bidCount,
        watchCount: l.watchCount,
        createdAt: l.createdAt,
        seller: {
          id: l.sellerId,
          shopName: p?.shopName || u?.name || "Seller",
          slug: p?.slug || null,
          avatarEmoji: u?.avatarEmoji || "🙂",
          ratingAvg: p?.ratingAvg ?? 0,
        },
        category: c ? { id: c.id, slug: c.slug, name: c.name, nameJa: c.nameJa, icon: c.icon } : null,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return fail("Search failed, please retry", 500, requestId)
  }
}

// ── POST /api/listings — seller creates a listing → PENDING_REVIEW moderation queue ──
const createSchema = z.object({
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(5000),
  categoryId: z.string().min(1),
  condition: z.enum(["NEW", "USED", "REFURB"]),
  type: z.enum(["AUCTION", "BUY_NOW"]),
  startingPrice: z.number().positive().max(1_000_000),
  buyNowPrice: z.number().positive().max(1_000_000).optional(),
  stock: z.number().int().min(1).max(999).optional(),
  images: z.array(z.string().max(300)).max(4).default([]),
  endsAtHours: z.number().int().min(1).max(120).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)
  if (user.role !== "SELLER" && !user.isSeller && !STAFF_ROLES.includes(user.role as never)) {
    return fail("A seller account is required to list items", 403, requestId)
  }
  const { data, error: bodyErr } = await parseBody(req, createSchema)
  if (bodyErr) return bodyErr

  if (isLegacyPrismaAuction(data.type)) {
    const policy = AUCTION_AUTHORITY_ERRORS.AUCTION_AUTHORITY_MOVED
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auction.authority.blocked.prisma_create",
      targetType: "LISTING",
      after: { requestedType: data.type, ...authorityDetails("AUCTION_AUTHORITY_MOVED") },
      requestId,
      ip,
    })
    return fail(policy.message, policy.status, requestId, authorityDetails("AUCTION_AUTHORITY_MOVED"))
  }

  if (!rateLimit(`listing_create:${user.id}`, 10, 3600_000)) {
    return fail("Too many listings created — try again later", 429, requestId)
  }

  const cat = await db.category.findUnique({ where: { id: data.categoryId } })
  if (!cat || !cat.active) return fail("Category not found", 404, requestId)

  if (data.type === "AUCTION" && (data.endsAtHours === undefined)) {
    return fail("Auctions need a duration (endsAtHours)", 422, requestId)
  }
  if (data.buyNowPrice !== undefined && data.buyNowPrice <= data.startingPrice) {
    return fail("Buy-now price must exceed the starting price", 422, requestId)
  }

  const settings = await getSettings()
  const now = new Date()
  try {
    const created = await db.listing.create({
      data: {
        sellerId: user.id,
        categoryId: cat.id,
        title: data.title,
        description: data.description,
        condition: data.condition,
        type: data.type,
        startingPrice: round2(data.startingPrice),
        buyNowPrice: data.buyNowPrice !== undefined ? round2(data.buyNowPrice) : undefined,
        currentPrice: data.type === "BUY_NOW" ? round2(data.buyNowPrice ?? data.startingPrice) : round2(data.startingPrice),
        stock: data.type === "BUY_NOW" ? (data.stock ?? 5) : 1,
        images: JSON.stringify(data.images.slice(0, 4)),
        status: "PENDING_REVIEW",
        endsAt: data.type === "AUCTION" && data.endsAtHours ? new Date(now.getTime() + data.endsAtHours * 3600_000) : undefined,
      },
    })
    await db.listingVersion.create({
      data: {
        listingId: created.id,
        version: 1,
        snapshot: JSON.stringify({
          title: created.title, description: created.description, condition: created.condition,
          type: created.type, startingPrice: created.startingPrice, buyNowPrice: created.buyNowPrice,
          stock: created.stock, images: data.images,
        }),
        changedBy: user.id,
        changeNote: "Initial listing",
      },
    })
    await notify(user.id, "LISTING_SUBMITTED", { listingId: created.id, title: created.title, status: "PENDING_REVIEW" })
    await audit({
      actorId: user.id, actorRole: user.role, action: "listing.create", targetType: "LISTING", targetId: created.id,
      after: { title: created.title, type: created.type, status: "PENDING_REVIEW", startingPrice: created.startingPrice },
      requestId, ip,
    })
    return ok({ id: created.id, status: created.status, bidIncrement: settings.bidIncrement }, requestId, 201)
  } catch {
    return fail("Could not create listing", 500, requestId)
  }
}
