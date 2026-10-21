import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { hashPassword } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(100),
  name: z.string().min(2).max(60),
  handle: z.string().regex(/^[a-z0-9_]{3,20}$/).optional(),
  locale: z.enum(["en", "ja"]).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const email = data.email.toLowerCase().trim()
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) return fail("An account with this email already exists", 409, requestId)
  let handle = data.handle || email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user"
  const taken = await db.user.findUnique({ where: { handle } })
  if (taken) handle = `${handle}_${Math.floor(Math.random() * 9999)}`
  const user = await db.user.create({
    data: {
      email,
      handle,
      name: data.name,
      passwordHash: hashPassword(data.password),
      locale: data.locale || "en",
      role: "BUYER",
      status: "ACTIVE",
    },
  })
  await db.consentRecord.create({
    data: { userId: user.id, purpose: "TERMS", granted: true, source: "signup", grantedAt: new Date(), evidence: "signup-checkbox" },
  })
  // Default notification preferences: transactional ON, marketing OFF (privacy-by-default)
  for (const ev of ["OUTBID", "WIN", "ORDER", "SHIP", "MSG"]) {
    for (const ch of ["EMAIL", "INAPP"]) {
      await db.notificationPref.create({ data: { userId: user.id, channel: ch, event: ev, enabled: true } }).catch(() => undefined)
    }
  }
  for (const ch of ["EMAIL", "INAPP"]) {
    await db.notificationPref.create({ data: { userId: user.id, channel: ch, event: "MARKETING", enabled: false } }).catch(() => undefined)
  }
  await audit({ actorId: user.id, actorRole: "BUYER", action: "user.register", targetType: "USER", targetId: user.id, requestId, ip })
  return ok({ id: user.id, email: user.email, handle: user.handle }, requestId, 201)
}
