import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser, rateLimit, scrubPII, STAFF_ROLES, Role } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

// ── helpers ────────────────────────────────────────────────────
// NOTE: the schema uses scalar FKs (no Prisma relations), so all joins are manual.
type ThreadRow = { id: string; listingId: string | null; buyerId: string; sellerId: string; subject: string; status: string; lastMessageAt: Date }
type UserBrief = { id: string; name: string; handle: string; avatarEmoji: string; shopName: string | null }

function firstImage(imagesJson: string | null | undefined): string | null {
  if (!imagesJson) return null
  try {
    const arr = JSON.parse(imagesJson) as string[]
    return Array.isArray(arr) && arr.length ? arr[0] : null
  } catch {
    return null
  }
}

async function decorateThreads(rows: ThreadRow[], viewerId: string) {
  const listingIds = [...new Set(rows.map(r => r.listingId).filter((v): v is string => !!v))]
  const userIds = [...new Set(rows.flatMap(r => [r.buyerId, r.sellerId]))]
  const [listings, users, sellerProfiles, lastMessages] = await Promise.all([
    listingIds.length
      ? db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, images: true } })
      : Promise.resolve([] as { id: string; title: string; images: string }[]),
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, handle: true, avatarEmoji: true } })
      : Promise.resolve([] as { id: string; name: string; handle: string; avatarEmoji: string }[]),
    userIds.length
      ? db.sellerProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, shopName: true } })
      : Promise.resolve([] as { userId: string; shopName: string }[]),
    Promise.all(
      rows.map(r =>
        db.message.findFirst({
          where: { threadId: r.id },
          orderBy: { createdAt: "desc" },
          select: { body: true, redacted: true },
        })
      )
    ),
  ])
  const listingMap = new Map(listings.map(l => [l.id, { id: l.id, title: l.title, image: firstImage(l.images) }]))
  const shopMap = new Map(sellerProfiles.map(s => [s.userId, s.shopName]))
  const userMap = new Map<string, UserBrief>(
    users.map(u => [u.id, { id: u.id, name: u.name, handle: u.handle, avatarEmoji: u.avatarEmoji, shopName: shopMap.get(u.id) ?? null }])
  )
  return rows.map((r, i) => {
    const preview = lastMessages[i]
    return {
      id: r.id,
      subject: r.subject,
      status: r.status,
      lastMessageAt: r.lastMessageAt,
      youAre: r.buyerId === viewerId ? "BUYER" : r.sellerId === viewerId ? "SELLER" : "STAFF",
      listing: r.listingId ? listingMap.get(r.listingId) ?? null : null,
      buyer: userMap.get(r.buyerId) ?? { id: r.buyerId, name: "Unknown", handle: "?", avatarEmoji: "❓", shopName: null },
      seller: userMap.get(r.sellerId) ?? { id: r.sellerId, name: "Unknown", handle: "?", avatarEmoji: "❓", shopName: null },
      preview: preview?.body ?? "",
      previewRedacted: preview?.redacted ?? false,
    }
  })
}

// ── GET /api/threads — my threads (buyer or seller side); ?all=1 for staff ──
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const isStaff = STAFF_ROLES.includes(user.role as Role)
  const all = req.nextUrl.searchParams.get("all") === "1" && isStaff
  const rows = await db.messageThread.findMany({
    where: all ? {} : { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  })
  const items = await decorateThreads(rows, user.id)
  return ok({ items, scope: all ? "ALL" : "MINE", isStaff }, requestId)
}

// ── POST /api/threads — open a thread on a listing (buyer side) ──
const postSchema = z.object({
  listingId: z.string().min(1).max(64),
  subject: z.string().min(2).max(140),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  if (!rateLimit(`threads:new:${user.id}`, 10, 3_600_000)) {
    return fail("Too many new conversations — please wait a while and try again", 429, requestId)
  }
  const { data, error } = await parseBody(req, postSchema)
  if (error) return error
  const listing = await db.listing.findUnique({ where: { id: data.listingId } })
  if (!listing) return fail("Listing not found", 404, requestId)
  if (listing.sellerId === user.id) {
    return fail("You can't start a conversation with yourself on your own listing", 400, requestId)
  }
  // One thread per (buyer, listing) — return the existing one
  const existing = await db.messageThread.findFirst({
    where: { buyerId: user.id, listingId: listing.id },
  })
  if (existing) {
    return ok({ id: existing.id, subject: existing.subject, status: existing.status, existing: true }, requestId)
  }
  const scrubbed = scrubPII(data.subject)
  const thread = await db.messageThread.create({
    data: {
      listingId: listing.id,
      buyerId: user.id,
      sellerId: listing.sellerId,
      subject: scrubbed.clean.slice(0, 140),
      status: "OPEN",
    },
  })
  // Opening system note so the thread is never empty
  await db.message.create({
    data: {
      threadId: thread.id,
      senderId: null,
      senderRole: "SYSTEM",
      body: "Conversation opened. Keep all contact and payment on Tengasell — off-platform deals void buyer protection.",
    },
  }).catch(() => undefined)
  const seller = await db.user.findUnique({ where: { id: listing.sellerId } })
  if (seller) {
    await notifyCounterpart(seller, thread, { withEmail: true }).catch(() => undefined)
  }
  await audit({
    actorId: user.id, actorRole: user.role, action: "thread.create",
    targetType: "THREAD", targetId: thread.id,
    after: { listingId: listing.id, subject: thread.subject, redacted: scrubbed.redacted },
    requestId, ip,
  })
  return ok(
    { id: thread.id, subject: thread.subject, status: thread.status, existing: false, redacted: scrubbed.redacted },
    requestId, 201
  )
}

// In-app MSG notification + "ticket_reply"-style transactional email (MSG-004/MSG-009)
async function notifyCounterpart(
  recipient: { id: string; email: string; name: string },
  thread: { id: string; subject: string },
  opts: { withEmail: boolean }
) {
  const inAppPref = await db.notificationPref.findFirst({
    where: { userId: recipient.id, channel: "INAPP", event: "MSG" },
  })
  if (inAppPref?.enabled !== false) {
    await db.notification.create({
      data: {
        userId: recipient.id,
        type: "MSG",
        params: JSON.stringify({ threadId: thread.id, subject: thread.subject }),
      },
    }).catch(() => undefined)
  }
  if (!opts.withEmail) return
  const emailPref = await db.notificationPref.findFirst({
    where: { userId: recipient.id, channel: "EMAIL", event: "MSG" },
  })
  if (emailPref?.enabled === false) return
  const tpl = await db.template.findUnique({ where: { key: "ticket_reply" } })
  const body = (tpl?.bodyEn || "Hi {{name}}, you have a new message about {{ref}}. Reply on Tengasell: {{link}}")
    .replace(/\{\{name\}\}/g, recipient.name)
    .replace(/\{\{ref\}\}/g, thread.subject)
    .replace(/\{\{link\}\}/g, "https://tengasell.co.zw/messages")
  await db.emailOutbox.create({
    data: {
      toEmail: recipient.email,
      userId: recipient.id,
      subject: `New message: ${thread.subject}`,
      body,
      templateKey: "ticket_reply",
      kind: "TRANSACTIONAL",
      status: "QUEUED",
    },
  }).catch(() => undefined)
}
