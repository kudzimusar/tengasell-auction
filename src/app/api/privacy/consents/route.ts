import { NextRequest } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

const PURPOSES = ["MARKETING", "COOKIES_ANALYTICS", "TERMS", "PRIVACY"] as const

// GET /api/privacy/consents — my consent records
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const items = await db.consentRecord.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  })
  return ok({ items }, requestId)
}

// PUT /api/privacy/consents — upsert a consent ({ purpose, granted })
const schema = z.object({
  purpose: z.enum(PURPOSES),
  granted: z.boolean(),
})

export async function PUT(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const existing = await db.consentRecord.findFirst({ where: { userId: user.id, purpose: data.purpose } })
  const before = { granted: existing?.granted ?? null, purpose: data.purpose }

  let record
  if (existing) {
    record = await db.consentRecord.update({
      where: { id: existing.id },
      data: {
        granted: data.granted,
        grantedAt: data.granted ? new Date() : existing.grantedAt,
        withdrawnAt: data.granted ? null : new Date(),
        source: "account_center",
        evidence: "account_center",
      },
    })
  } else {
    record = await db.consentRecord.create({
      data: {
        userId: user.id,
        purpose: data.purpose,
        granted: data.granted,
        source: "account_center",
        grantedAt: data.granted ? new Date() : undefined,
        withdrawnAt: data.granted ? undefined : new Date(),
        evidence: "account_center",
      },
    })
  }

  // Marketing consent mirrors into notification prefs + suppression list (PRV-003)
  if (data.purpose === "MARKETING") {
    for (const ch of ["EMAIL", "INAPP"] as const) {
      const pref = await db.notificationPref.findFirst({ where: { userId: user.id, channel: ch, event: "MARKETING" } })
      if (pref) {
        if (pref.enabled !== data.granted) await db.notificationPref.update({ where: { id: pref.id }, data: { enabled: data.granted } })
      } else {
        await db.notificationPref.create({ data: { userId: user.id, channel: ch, event: "MARKETING", enabled: data.granted } })
      }
    }
    if (data.granted) {
      await db.suppression.deleteMany({ where: { OR: [{ email: user.email }, { userId: user.id }] } })
    } else {
      const supp = await db.suppression.findFirst({ where: { OR: [{ email: user.email }, { userId: user.id }] } })
      if (!supp) {
        await db.suppression.create({
          data: { userId: user.id, email: user.email, reason: "UNSUBSCRIBE_LINK", token: randomBytes(12).toString("hex") },
        })
      }
    }
  }

  await audit({
    actorId: user.id, actorRole: user.role, action: "consent.update",
    targetType: "USER", targetId: user.id, before, after: { granted: data.granted, purpose: data.purpose },
    requestId, ip,
  })
  return ok({ consent: record }, requestId)
}
