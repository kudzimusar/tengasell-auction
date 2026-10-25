// GET /api/listings/[id] — full detail: listing + category + seller + bids(anonymised) + similar + versionCount
// Non-public statuses (DRAFT/PENDING_REVIEW/REJECTED/SUSPENDED/CANCELLED) visible to owner/staff only.
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { PUBLIC_LISTING_STATUSES, anonName, getSettings, round2 } from "@/app/api/listings/shared/mkt"
import { auctionAuthorityPayload, canonicalBidHistory, resolveLegacyAuction } from "@/lib/server/legacy-auction-convergence"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { id } = await params
  const { user } = await requireUser()
  const isStaff = !!user && STAFF_ROLES.includes(user.role as never)

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return fail("Listing not found", 404, requestId)

  const isOwner = !!user && user.id === listing.sellerId
  const auctionResolution = await resolveLegacyAuction(listing)
  const effectiveStatus = auctionResolution.effective.status
  const isPublic = (PUBLIC_LISTING_STATUSES as readonly string[]).includes(effectiveStatus)
  if (!isPublic && !isOwner && !isStaff) {
    return fail("This listing is not available", 404, requestId)
  }

  const [cat, sellerUser, profile, bids, versionCount, similarRows, settings] = await Promise.all([
    db.category.findUnique({ where: { id: listing.categoryId } }),
    db.user.findUnique({ where: { id: listing.sellerId }, select: { id: true, name: true, avatarEmoji: true, city: true, createdAt: true, status: true } }),
    db.sellerProfile.findUnique({ where: { userId: listing.sellerId } }),
    db.bid.findMany({ where: { listingId: listing.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.listingVersion.count({ where: { listingId: listing.id } }),
    db.listing.findMany({
      where: { categoryId: listing.categoryId, status: "ACTIVE", id: { not: listing.id } },
      orderBy: { createdAt: "desc" }, take: 4,
    }),
    getSettings(),
  ])
  const canonicalBids = listing.type === "AUCTION"
    ? await canonicalBidHistory(auctionResolution, 10)
    : []

  // Anonymised bid history
  const bidderIds = [...new Set(bids.map(b => b.bidderId))]
  const bidders = bidderIds.length ? await db.user.findMany({ where: { id: { in: bidderIds } }, select: { id: true, name: true } }) : []
  const bidderMap = new Map(bidders.map(b => [b.id, b]))

  // Similar listings (same category) — join minimal seller info
  const simSellerIds = [...new Set(similarRows.map(s => s.sellerId))]
  const [simUsers, simProfiles] = await Promise.all([
    simSellerIds.length ? db.user.findMany({ where: { id: { in: simSellerIds } }, select: { id: true, name: true, avatarEmoji: true } }) : [],
    simSellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: simSellerIds } } }) : [],
  ])
  const simUserMap = new Map(simUsers.map(u => [u.id, u]))
  const simProfMap = new Map(simProfiles.map(p => [p.userId, p]))

  let isWatched = false
  if (user) {
    isWatched = !!(await db.watch.findUnique({ where: { userId_listingId: { userId: user.id, listingId: listing.id } } }))
  }

  // Fire-and-forget view counter (skip owner self-views)
  if (!isOwner && listing.type !== "AUCTION") {
    void db.listing.update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined)
  }

  const data = {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    condition: listing.condition,
    type: listing.type,
    startingPrice: round2(listing.startingPrice),
    buyNowPrice: listing.buyNowPrice === null ? null : round2(listing.buyNowPrice),
    currentPrice: round2(auctionResolution.effective.currentPrice),
    stock: listing.stock,
    images: json(listing.images, [] as string[]),
    status: effectiveStatus,
    rejectReason: isOwner || isStaff ? listing.rejectReason : undefined,
    endsAt: auctionResolution.effective.endsAt,
    endedAt: listing.endedAt,
    viewCount: listing.viewCount,
    bidCount: auctionResolution.effective.bidCount,
    watchCount: listing.watchCount,
    createdAt: listing.createdAt,
    publishedAt: listing.publishedAt,
    category: cat ? { id: cat.id, slug: cat.slug, name: cat.name, nameJa: cat.nameJa, icon: cat.icon } : null,
    seller: sellerUser
      ? {
          id: sellerUser.id,
          name: sellerUser.name,
          avatarEmoji: sellerUser.avatarEmoji,
          city: sellerUser.city,
          memberSince: sellerUser.createdAt,
          userStatus: sellerUser.status,
          shopName: profile?.shopName || sellerUser.name,
          slug: profile?.slug || null,
          shopStatus: profile?.status || "PENDING",
          bio: profile?.bio || undefined,
          ratingAvg: profile?.ratingAvg ?? 0,
          ratingCount: profile?.ratingCount ?? 0,
          healthScore: profile?.healthScore ?? 100,
          identityVerified: profile?.identityVerified ?? false,
        }
      : null,
    bids: auctionResolution.state === "VERIFIED_CANONICAL"
      ? canonicalBids.map((b) => ({
          id: b.id,
          amount: round2(b.amount),
          bidderName: anonName(String(b.bidder_username ?? "")),
          isMine: false,
          createdAt: b.created_at,
        }))
      : bids.map(b => ({
          id: b.id,
          amount: round2(b.amount),
          bidderName: anonName(bidderMap.get(b.bidderId)?.name || ""),
          isMine: !!user && b.bidderId === user.id,
          createdAt: b.createdAt,
        })),
    versionCount,
    similar: similarRows.map(s => {
      const u = simUserMap.get(s.sellerId)
      const p = simProfMap.get(s.sellerId)
      return {
        id: s.id,
        title: s.title,
        condition: s.condition,
        type: s.type,
        currentPrice: round2(s.currentPrice),
        buyNowPrice: s.buyNowPrice === null ? null : round2(s.buyNowPrice),
        images: json(s.images, [] as string[]).slice(0, 1),
        status: s.status,
        endsAt: s.endsAt,
        bidCount: s.bidCount,
        seller: { shopName: p?.shopName || u?.name || "Seller", slug: p?.slug || null, avatarEmoji: u?.avatarEmoji || "🙂" },
      }
    }),
    viewer: { isOwner, isStaff, isWatched },
    auctionAuthority: listing.type === "AUCTION" ? auctionAuthorityPayload(auctionResolution) : undefined,
    meta: { bidIncrement: settings.bidIncrement, vatRate: settings.vatRate, sellerFeePct: settings.sellerFeePct },
  }
  return ok(data, requestId)
}
