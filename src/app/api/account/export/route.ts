import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { fail, ctxFrom, audit } from "@/lib/server/api"

export const runtime = "nodejs"

// POST /api/account/export — data portability download (PRV-008).
// Gathers ALL user-held data and returns it as a JSON attachment.
export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)

  const [
    sellerProfile, listings, bids, ordersBuyer, ordersSeller, threads,
    reviewsGiven, reviewsReceived, notifications, consents, prefs,
    dsars, payouts, apiKeys, watches, savedSearches, suppressions, outbox, tickets, sessions,
  ] = await Promise.all([
    db.sellerProfile.findUnique({ where: { userId: user.id } }),
    db.listing.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } }),
    db.bid.findMany({ where: { bidderId: user.id }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { buyerId: user.id }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } }),
    db.messageThread.findMany({ where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] }, orderBy: { lastMessageAt: "desc" } }),
    db.review.findMany({ where: { authorId: user.id }, orderBy: { createdAt: "desc" } }),
    db.review.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.consentRecord.findMany({ where: { userId: user.id } }),
    db.notificationPref.findMany({ where: { userId: user.id } }),
    db.dsarRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    db.payout.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: "desc" } }),
    db.apiKey.findMany({ where: { userId: user.id } }),
    db.watch.findMany({ where: { userId: user.id } }),
    db.savedSearch.findMany({ where: { userId: user.id } }),
    db.suppression.findMany({ where: { OR: [{ userId: user.id }, { email: user.email }] } }),
    db.emailOutbox.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.ticket.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    db.sessionRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ])

  // Manual joins for listing titles (schema has scalar FKs only)
  const listingIdRefs = [
    ...bids.map(b => b.listingId),
    ...ordersBuyer.map(o => o.listingId),
    ...ordersSeller.map(o => o.listingId),
  ]
  const refListings = listingIdRefs.length
    ? await db.listing.findMany({ where: { id: { in: [...new Set(listingIdRefs)] } }, select: { id: true, title: true } })
    : []
  const titleMap = new Map(refListings.map(l => [l.id, l.title]))

  const threadIds = threads.map(t => t.id)
  const messages = threadIds.length
    ? await db.message.findMany({ where: { threadId: { in: threadIds } }, orderBy: { createdAt: "asc" } })
    : []

  const payload = {
    format: "tengasell.export.v1",
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id, email: user.email, handle: user.handle, name: user.name, phone: user.phone,
      locale: user.locale, role: user.role, status: user.status, avatarEmoji: user.avatarEmoji,
      bio: user.bio, city: user.city, country: user.country, isSeller: user.isSeller,
      mfaEnabled: user.mfaEnabled, emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    },
    sellerProfile,
    listings,
    bids: bids.map(b => ({ ...b, listingTitle: titleMap.get(b.listingId) ?? null })),
    orders: {
      asBuyer: ordersBuyer.map(o => ({ ...o, listingTitle: titleMap.get(o.listingId) ?? null })),
      asSeller: ordersSeller.map(o => ({ ...o, listingTitle: titleMap.get(o.listingId) ?? null })),
    },
    messageThreads: threads,
    messages,
    reviews: { given: reviewsGiven, received: reviewsReceived },
    notifications,
    consentRecords: consents,
    notificationPreferences: prefs,
    dsarRequests: dsars,
    payouts,
    apiKeys: apiKeys.map(k => ({
      name: k.name, prefix: k.prefix, scopes: k.scopes, ratePerMin: k.ratePerMin,
      lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt,
    })), // keyHash masked — secrets are never exported
    watchlist: watches,
    savedSearches,
    suppressions: suppressions.map(s => ({ email: s.email, reason: s.reason, createdAt: s.createdAt })),
    emailOutbox: outbox,
    supportTickets: tickets,
    sessions: sessions.map(s => ({ ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, revokedAt: s.revokedAt, lastSeenAt: s.lastSeenAt })),
  }

  await db.appLog.create({
    data: {
      level: "info", source: "privacy", message: "privacy.export",
      context: JSON.stringify({ userId: user.id, scope: "full_export" }),
      requestId,
    },
  }).catch(() => undefined)
  await audit({
    actorId: user.id, actorRole: user.role, action: "privacy.export",
    targetType: "USER", targetId: user.id,
    after: { scope: "full_export" },
    requestId, ip,
  })
  await db.notification.create({
    data: {
      userId: user.id,
      type: "PRIVACY_EXPORT",
      params: JSON.stringify({ scope: "full_export" }),
    },
  }).catch(() => undefined)

  const filename = `tengasell-export-${user.handle}-${new Date().toISOString().slice(0, 10)}.json`
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
