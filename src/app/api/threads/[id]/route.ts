import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser, rateLimit, scrubPII, STAFF_ROLES, Role } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

function firstImage(imagesJson: string | null | undefined): string | null {
  if (!imagesJson) return null
  try {
    const arr = JSON.parse(imagesJson) as string[]
    return Array.isArray(arr) && arr.length ? arr[0] : null
  } catch {
    return null
  }
}

// ── GET /api/threads/[id] — thread meta + messages asc (participant or staff) ──
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { id } = await params
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const thread = await db.messageThread.findUnique({ where: { id } })
  if (!thread) return fail("Conversation not found", 404, requestId)
  const isStaff = STAFF_ROLES.includes(user.role as Role)
  const isParticipant = thread.buyerId === user.id || thread.sellerId === user.id
  if (!isParticipant && !isStaff) return fail("You don't have access to this conversation", 403, requestId)

  const [listing, buyer, seller, sellerShop, messages] = await Promise.all([
    thread.listingId
      ? db.listing.findUnique({ where: { id: thread.listingId }, select: { id: true, title: true, images: true } })
      : Promise.resolve(null),
    db.user.findUnique({
      where: { id: thread.buyerId },
      select: { id: true, name: true, handle: true, avatarEmoji: true },
    }),
    db.user.findUnique({
      where: { id: thread.sellerId },
      select: { id: true, name: true, handle: true, avatarEmoji: true },
    }),
    db.sellerProfile.findUnique({ where: { userId: thread.sellerId }, select: { shopName: true } }),
    db.message.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } }),
  ])
  const senderIds = [...new Set(messages.map(m => m.senderId).filter((v): v is string => !!v))]
  const senders = senderIds.length
    ? await db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true, avatarEmoji: true, handle: true } })
    : []
  const senderMap = new Map(senders.map(s => [s.id, s]))

  // Mark my MSG notifications for this thread as read (supports the unread badge)
  await db.notification.updateMany({
    where: { userId: user.id, type: "MSG", readAt: null, params: { contains: thread.id } },
    data: { readAt: new Date() },
  }).catch(() => undefined)
  const unreadAfter = await db.notification.count({ where: { userId: user.id, readAt: null } })

  return ok({
    thread: {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      lastMessageAt: thread.lastMessageAt,
      createdAt: thread.createdAt,
      listingId: thread.listingId,
      youAre: thread.buyerId === user.id ? "BUYER" : thread.sellerId === user.id ? "SELLER" : "STAFF",
      listing: listing ? { id: listing.id, title: listing.title, image: firstImage(listing.images) } : null,
      buyer: buyer
        ? { id: buyer.id, name: buyer.name, handle: buyer.handle, avatarEmoji: buyer.avatarEmoji }
        : null,
      seller: seller
        ? {
            id: seller.id, name: seller.name, handle: seller.handle, avatarEmoji: seller.avatarEmoji,
            shopName: sellerShop?.shopName ?? null,
          }
        : null,
    },
    messages: messages.map(m => ({
      id: m.id,
      senderRole: m.senderRole,
      sender: m.senderId ? senderMap.get(m.senderId) ?? null : null,
      body: m.body,
      redacted: m.redacted,
      moderationNote: m.moderationNote,
      createdAt: m.createdAt,
    })),
    unreadAfter,
  }, requestId)
}

// ── POST /api/threads/[id] — send a message (scrub PII, notify, rate-limit) ──
const postSchema = z.object({ body: z.string().min(1).max(4000) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const thread = await db.messageThread.findUnique({ where: { id } })
  if (!thread) return fail("Conversation not found", 404, requestId)
  const isStaff = STAFF_ROLES.includes(user.role as Role)
  const isParticipant = thread.buyerId === user.id || thread.sellerId === user.id
  if (!isParticipant && !isStaff) return fail("You don't have access to this conversation", 403, requestId)
  if (thread.status === "CLOSED" && !isStaff) {
    return fail("This conversation is closed", 400, requestId)
  }
  // 30 messages per hour per thread
  if (!rateLimit(`msg:${thread.id}`, 30, 3_600_000)) {
    return fail("This conversation is moving too fast — please wait a moment", 429, requestId)
  }
  const { data, error } = await parseBody(req, postSchema)
  if (error) return error

  let senderRole: "BUYER" | "SELLER" | "COMPANY"
  if (thread.buyerId === user.id) senderRole = "BUYER"
  else if (thread.sellerId === user.id) senderRole = "SELLER"
  else if (isStaff) senderRole = "COMPANY"
  else return fail("You don't have access to this conversation", 403, requestId)

  let bodyText = data.body.trim()
  let redacted = false
  let moderationNote: string | undefined
  if (senderRole !== "COMPANY") {
    const scrubbed = scrubPII(bodyText)
    bodyText = scrubbed.clean
    redacted = scrubbed.redacted
    if (redacted) moderationNote = "PII auto-redacted"
  }

  const message = await db.message.create({
    data: {
      threadId: thread.id,
      senderId: senderRole === "COMPANY" ? null : user.id,
      senderRole,
      body: bodyText,
      redacted,
      moderationNote,
    },
  })
  await db.messageThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date() } })

  // Notify counterpart(s): in-app Notification type MSG; email in ticket_reply style
  // (skipped for COMPANY messages). COMPANY notes go to both buyer and seller.
  const recipientIds =
    senderRole === "BUYER" ? [thread.sellerId]
      : senderRole === "SELLER" ? [thread.buyerId]
        : [thread.buyerId, thread.sellerId]
  const withEmail = senderRole !== "COMPANY"
  for (const rid of recipientIds) {
    const r = await db.user.findUnique({ where: { id: rid } })
    if (!r) continue
    const inAppPref = await db.notificationPref.findFirst({
      where: { userId: r.id, channel: "INAPP", event: "MSG" },
    })
    if (inAppPref?.enabled !== false) {
      await db.notification.create({
        data: {
          userId: r.id,
          type: "MSG",
          params: JSON.stringify({ threadId: thread.id, subject: thread.subject }),
        },
      }).catch(() => undefined)
    }
    if (!withEmail) continue
    const emailPref = await db.notificationPref.findFirst({
      where: { userId: r.id, channel: "EMAIL", event: "MSG" },
    })
    if (emailPref?.enabled === false) continue
    const tpl = await db.template.findUnique({ where: { key: "ticket_reply" } })
    const emailBody = (tpl?.bodyEn || "Hi {{name}}, you have a new message about {{ref}}. Reply on Tengasell: {{link}}")
      .replace(/\{\{name\}\}/g, r.name)
      .replace(/\{\{ref\}\}/g, thread.subject)
      .replace(/\{\{link\}\}/g, "https://tengasell.co.zw/messages")
    await db.emailOutbox.create({
      data: {
        toEmail: r.email,
        userId: r.id,
        subject: `New message: ${thread.subject}`,
        body: emailBody,
        templateKey: "ticket_reply",
        kind: "TRANSACTIONAL",
        status: "QUEUED",
      },
    }).catch(() => undefined)
  }

  await audit({
    actorId: user.id, actorRole: user.role, action: "message.send",
    targetType: "THREAD", targetId: thread.id,
    after: { messageId: message.id, senderRole, redacted },
    requestId, ip,
  })

  return ok(
    {
      message: {
        id: message.id,
        senderRole: message.senderRole,
        sender: senderRole === "COMPANY"
          ? null
          : { id: user.id, name: user.name, avatarEmoji: user.avatarEmoji, handle: user.handle },
        body: message.body,
        redacted: message.redacted,
        moderationNote: message.moderationNote,
        createdAt: message.createdAt,
      },
      redacted,
    },
    requestId, 201
  )
}
