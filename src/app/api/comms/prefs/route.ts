import { NextRequest } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

// Events × channels preference matrix (MSG-005). Defaults: transactional ON, marketing/digest OFF.
const EVENTS = ["OUTBID", "WIN", "ORDER", "SHIP", "MSG", "MARKETING", "DIGEST"] as const
const CHANNELS = ["EMAIL", "INAPP"] as const
type Event = (typeof EVENTS)[number]
type Channel = (typeof CHANNELS)[number]

function defaultEnabled(event: Event): boolean {
  return event !== "MARKETING" && event !== "DIGEST"
}

async function upsertPref(userId: string, channel: Channel, event: Event, enabled: boolean) {
  const existing = await db.notificationPref.findFirst({ where: { userId, channel, event } })
  const before = existing?.enabled ?? defaultEnabled(event)
  if (existing) {
    if (existing.enabled !== enabled) {
      await db.notificationPref.update({ where: { id: existing.id }, data: { enabled } })
    }
  } else {
    await db.notificationPref.create({ data: { userId, channel, event, enabled } })
  }
  return before
}

// Withdrawing MARKETING email consent also updates ConsentRecord + Suppression (PRV-003)
async function setMarketingConsent(userId: string, email: string, granted: boolean) {
  const existing = await db.consentRecord.findFirst({ where: { userId, purpose: "MARKETING" } })
  if (granted) {
    if (existing) {
      await db.consentRecord.update({
        where: { id: existing.id },
        data: { granted: true, grantedAt: new Date(), withdrawnAt: null, source: "comms_center", evidence: "comms_center" },
      })
    } else {
      await db.consentRecord.create({
        data: { userId, purpose: "MARKETING", granted: true, source: "comms_center", grantedAt: new Date(), evidence: "comms_center" },
      })
    }
    await db.suppression.deleteMany({ where: { OR: [{ email }, { userId }] } })
  } else {
    if (existing) {
      await db.consentRecord.update({
        where: { id: existing.id },
        data: { granted: false, withdrawnAt: new Date(), evidence: "comms_center" },
      })
    } else {
      await db.consentRecord.create({
        data: { userId, purpose: "MARKETING", granted: false, source: "comms_center", withdrawnAt: new Date(), evidence: "comms_center" },
      })
    }
    const supp = await db.suppression.findFirst({ where: { OR: [{ email }, { userId }] } })
    if (!supp) {
      await db.suppression.create({
        data: { userId, email, reason: "UNSUBSCRIBE_LINK", token: randomBytes(12).toString("hex") },
      })
    }
  }
}

// ── GET /api/comms/prefs — full matrix for the current user ──
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const rows = await db.notificationPref.findMany({ where: { userId: user.id } })
  const map = new Map(rows.map(r => [`${r.channel}:${r.event}`, r.enabled]))
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const ev of EVENTS) {
    matrix[ev] = {}
    for (const ch of CHANNELS) {
      matrix[ev][ch] = map.get(`${ch}:${ev}`) ?? defaultEnabled(ev)
    }
  }
  return ok({ events: EVENTS, channels: CHANNELS, matrix }, requestId)
}

// ── PUT /api/comms/prefs — upsert changes ({event,channel,enabled} or {changes:[…]}) ──
const changeSchema = z.object({
  event: z.enum(EVENTS),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
})
const putSchema = z.object({
  event: z.enum(EVENTS).optional(),
  channel: z.enum(CHANNELS).optional(),
  enabled: z.boolean().optional(),
  changes: z.array(changeSchema).optional(),
})

export async function PUT(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const { data, error } = await parseBody(req, putSchema)
  if (error) return error
  const changes: { event: Event; channel: Channel; enabled: boolean }[] = Array.isArray(data.changes)
    ? data.changes
    : data.event && data.channel && typeof data.enabled === "boolean"
      ? [{ event: data.event, channel: data.channel, enabled: data.enabled }]
      : []
  if (!changes.length) {
    return fail("Provide {event, channel, enabled} or {changes: […]}", 422, requestId)
  }

  const before: Record<string, boolean> = {}
  const after: Record<string, boolean> = {}
  let marketingWithdrawn = false
  let marketingGranted = false
  for (const c of changes) {
    if (c.event === "MARKETING" && c.channel === "EMAIL") {
      if (!c.enabled) marketingWithdrawn = true
      else marketingGranted = true
    }
    const prev = await upsertPref(user.id, c.channel, c.event, c.enabled)
    before[`${c.channel}:${c.event}`] = prev
    after[`${c.channel}:${c.event}`] = c.enabled
  }
  if (marketingWithdrawn) await setMarketingConsent(user.id, user.email, false)
  if (marketingGranted) await setMarketingConsent(user.id, user.email, true)

  await audit({
    actorId: user.id, actorRole: user.role, action: "prefs.update",
    targetType: "USER", targetId: user.id, before, after,
    reason: marketingWithdrawn ? "marketing_withdrawn" : undefined,
    requestId, ip,
  })
  return ok({ changes: after }, requestId)
}
