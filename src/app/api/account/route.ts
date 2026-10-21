import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser, hashPassword, verifyPassword } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

function publicUser(u: {
  id: string; email: string; handle: string; name: string; phone: string | null
  locale: string; role: string; status: string; avatarEmoji: string; bio: string | null
  city: string | null; country: string; isSeller: boolean; mfaEnabled: boolean
  emailVerifiedAt: Date | null; lastLoginAt: Date | null; createdAt: Date; riskScore: number
}) {
  return {
    id: u.id, email: u.email, handle: u.handle, name: u.name, phone: u.phone,
    locale: u.locale, role: u.role, status: u.status, avatarEmoji: u.avatarEmoji,
    bio: u.bio, city: u.city, country: u.country, isSeller: u.isSeller,
    mfaEnabled: u.mfaEnabled, emailVerifiedAt: u.emailVerifiedAt,
    lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, riskScore: u.riskScore,
  }
}

// ── GET /api/account — profile + seller profile + sessions + consents summary ──
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const [sellerProfile, activeSessions, consents] = await Promise.all([
    db.sellerProfile.findUnique({ where: { userId: user.id } }),
    db.sessionRecord.count({ where: { userId: user.id, revokedAt: null } }),
    db.consentRecord.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
  ])
  return ok({
    profile: publicUser(user),
    sellerProfile: sellerProfile
      ? {
          shopName: sellerProfile.shopName,
          slug: sellerProfile.slug,
          status: sellerProfile.status,
          bio: sellerProfile.bio,
          identityVerified: sellerProfile.identityVerified,
          payoutVerified: sellerProfile.payoutVerified,
          ratingAvg: sellerProfile.ratingAvg,
          ratingCount: sellerProfile.ratingCount,
          healthScore: sellerProfile.healthScore,
          payoutMethod: (() => {
            try { return JSON.parse(sellerProfile.payoutMethod || "null") } catch { return null }
          })(),
          joinedAt: sellerProfile.joinedAt,
        }
      : null,
    activeSessions,
    consents,
  }, requestId)
}

// ── PATCH /api/account — profile fields; password via ?action=password or body flag ──
const patchSchema = z.object({
  action: z.enum(["password", "profile"]).optional(),
  currentPassword: z.string().min(1).max(100).optional(),
  newPassword: z.string().min(8).max(100).optional(),
  name: z.string().min(2).max(60).optional(),
  city: z.string().max(60).optional(),
  locale: z.enum(["en", "ja"]).optional(),
  avatarEmoji: z.string().min(1).max(10).optional(),
  bio: z.string().max(500).optional(),
})

export async function PATCH(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const { data, error } = await parseBody(req, patchSchema)
  if (error) return error
  const isPassword =
    req.nextUrl.searchParams.get("action") === "password" ||
    data.action === "password" ||
    data.newPassword !== undefined

  if (isPassword) {
    if (!data.currentPassword || !data.newPassword) {
      return fail("Both currentPassword and newPassword are required to change password", 422, requestId)
    }
    if (!verifyPassword(data.currentPassword, user.passwordHash)) {
      return fail("Current password is incorrect", 403, requestId)
    }
    if (data.currentPassword === data.newPassword) {
      return fail("New password must be different from the current password", 422, requestId)
    }
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(data.newPassword) } })
    // Revoke all other sessions (JWT max-age is short; SessionRecord evidence is revoked now)
    const revoked = await db.sessionRecord.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await audit({
      actorId: user.id, actorRole: user.role, action: "account.password_change",
      targetType: "USER", targetId: user.id,
      after: { sessionsRevoked: revoked.count },
      requestId, ip,
    })
    return ok({ passwordChanged: true, sessionsRevoked: revoked.count }, requestId)
  }

  // Profile update
  const updates: Partial<{ name: string; city: string | null; locale: string; avatarEmoji: string; bio: string | null }> = {}
  if (data.name !== undefined) updates.name = data.name.trim()
  if (data.city !== undefined) updates.city = data.city.trim() || null
  if (data.locale !== undefined) updates.locale = data.locale
  if (data.avatarEmoji !== undefined) updates.avatarEmoji = data.avatarEmoji
  if (data.bio !== undefined) updates.bio = data.bio.trim() || null
  if (!Object.keys(updates).length) {
    return fail("Nothing to update — provide name, city, locale, avatarEmoji or bio", 422, requestId)
  }
  const before = { name: user.name, city: user.city, locale: user.locale, avatarEmoji: user.avatarEmoji, bio: user.bio }
  const updated = await db.user.update({ where: { id: user.id }, data: updates })
  await audit({
    actorId: user.id, actorRole: user.role, action: "account.update",
    targetType: "USER", targetId: user.id, before, after: updates,
    requestId, ip,
  })
  return ok({ profile: publicUser(updated), localeChanged: data.locale !== undefined && data.locale !== user.locale }, requestId)
}
