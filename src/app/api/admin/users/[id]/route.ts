// GET /api/admin/users/[id] — full 360 view (SUPPORT+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"
import { guard, STAFF_PLUS } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  try {
    const u = await db.user.findUnique({ where: { id } })
    if (!u) return fail("User not found", 404, requestId)

    const [sellerProfile, sessions, orderCount, listingCount, reportsFiled, reportsAgainst, enforcements, consents, auditRows] = await Promise.all([
      db.sellerProfile.findUnique({ where: { userId: u.id } }),
      db.sessionRecord.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.order.count({ where: { OR: [{ buyerId: u.id }, { sellerId: u.id }] } }),
      db.listing.count({ where: { sellerId: u.id } }),
      db.abuseReport.count({ where: { reporterId: u.id } }),
      db.abuseReport.count({ where: { targetType: "USER", targetId: u.id } }),
      db.enforcement.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.consentRecord.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.auditLog.findMany({
        where: { OR: [{ targetId: u.id }, { actorId: u.id }] },
        orderBy: { createdAt: "desc" }, take: 10,
      }),
    ])

    return ok({
      user: {
        id: u.id, email: u.email, handle: u.handle, name: u.name, phone: u.phone, locale: u.locale,
        role: u.role, status: u.status, statusReason: u.statusReason, riskScore: u.riskScore,
        avatarEmoji: u.avatarEmoji, bio: u.bio, city: u.city, country: u.country,
        isSeller: u.isSeller, mfaEnabled: u.mfaEnabled, emailVerifiedAt: u.emailVerifiedAt,
        lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      },
      sellerProfile,
      sessions: sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, revokedAt: s.revokedAt })),
      counts: {
        orders: orderCount, listings: listingCount,
        reportsFiled, reportsAgainst,
        sessions: sessions.length,
        sessionsActive: sessions.filter((s) => !s.revokedAt).length,
      },
      enforcements,
      consents,
      audit: auditRows,
    }, requestId)
  } catch {
    return fail("Could not load user", 500, requestId)
  }
}
