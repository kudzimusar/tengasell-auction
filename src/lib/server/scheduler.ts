// ── Background jobs (scheduler) — runs inside the Next.js server via instrumentation ──
import { db } from "@/lib/db"

const g = globalThis as unknown as { __tgsScheduler?: NodeJS.Timeout; __tgsLastBackup?: number; __tgsLastMetrics?: string }

export async function endExpiredAuctions() {
  const now = new Date()
  const expiring = await db.listing.findMany({
    where: { status: "ACTIVE", type: "AUCTION", endsAt: { lte: now } },
    take: 50,
  })
  for (const l of expiring) {
    const winner = await db.bid.findFirst({ where: { listingId: l.id, isActive: true }, orderBy: { amount: "desc" } })
    if (winner && winner.amount >= l.startingPrice) {
      const order = await db.order.create({
        data: {
          listingId: l.id, buyerId: winner.bidderId, sellerId: l.sellerId, type: "AUCTION",
          amount: winner.amount, totalCharged: winner.amount, status: "PENDING_PAYMENT",
        },
      })
      await db.listing.update({ where: { id: l.id }, data: { status: "SOLD", endedAt: now, currentPrice: winner.amount } })
      await db.bid.updateMany({ where: { listingId: l.id }, data: { isActive: false } })
      await db.orderEvent.create({ data: { orderId: order.id, type: "AUCTION_WON", actorId: winner.bidderId, data: JSON.stringify({ amount: winner.amount }) } })
      await db.notification.create({ data: { userId: winner.bidderId, type: "WIN", params: JSON.stringify({ listingId: l.id, title: l.title, orderId: order.id, amount: winner.amount }) } })
      await db.notification.create({ data: { userId: l.sellerId, type: "AUCTION_SOLD", params: JSON.stringify({ listingId: l.id, title: l.title, orderId: order.id }) } })
      await db.emailOutbox.create({ data: { toEmail: "winner@mock.local", userId: winner.bidderId, subject: `You won: ${l.title}`, body: `Congratulations! You won "${l.title}". Pay within 48h to complete the order. Order ${order.id}`, templateKey: "auction_won", kind: "TRANSACTIONAL" } }).catch(() => undefined)
    } else {
      await db.listing.update({ where: { id: l.id }, data: { status: "ENDED", endedAt: now } })
      await db.notification.create({ data: { userId: l.sellerId, type: "AUCTION_ENDED_NO_BID", params: JSON.stringify({ listingId: l.id, title: l.title }) } })
    }
  }
}

export async function dispatchOutbox(limit = 25) {
  const queued = await db.emailOutbox.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: limit })
  for (const m of queued) {
    await db.emailOutbox.update({ where: { id: m.id }, data: { status: "SENT", providerRef: `mock_${m.channel.toLowerCase()}_${m.id.slice(-8)}`, sentAt: new Date() } })
    // TUCS L1: marketing frequency cap accounting — 1 marketing msg / channel / 24h per account
    if (m.kind === "MARKETING" && m.channelAccountId) {
      await db.channelAccount.update({ where: { id: m.channelAccountId }, data: { lastMarketingAt: new Date() } }).catch(() => undefined)
    }
    if (m.campaignId) {
      const camp = await db.campaign.findUnique({ where: { id: m.campaignId } })
      if (camp) {
        const stats = JSON.parse(camp.stats || "{}")
        await db.campaign.update({ where: { id: camp.id }, data: { stats: JSON.stringify({ ...stats, sent: (stats.sent || 0) + 1 }) } })
      }
    }
  }
}

// Only rows whose token has actually been used (clicked) suppress future sends.
// Queue-time rows are a pending token registry for the one-click unsubscribe link (MSG-007), NOT suppression.
const SUPPRESSION_ACTIVE_REASONS = ["UNSUBSCRIBE_LINK", "UNSUBSCRIBED", "UNSUB_TOKEN_USED"]

export async function sendDueCampaigns() {
  const due = await db.campaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, take: 5 })
  for (const c of due) {
    const segment = JSON.parse(c.segment || "{}") as { role?: string; locale?: string; optInOnly?: boolean }
    const DAY_MS = 24 * 3600 * 1000

    // ── TUCS L1 routing: EMAIL consent + linked external channels (TELEGRAM/WHATSAPP/SOCIAL/SMS) ──
    const emailOptIns = await db.notificationPref.findMany({ where: { channel: "EMAIL", event: "MARKETING", enabled: true } })
    const optInEmail = new Set(emailOptIns.map(p => p.userId))
    const [channelAccounts, marketingPrefs, activeSuppressions] = await Promise.all([
      db.channelAccount.findMany({ where: { status: "LINKED", marketingOptIn: true, transactionalOn: true } }),
      db.notificationPref.findMany({ where: { event: "MARKETING", enabled: true } }),
      db.suppression.findMany({ where: { reason: { in: SUPPRESSION_ACTIVE_REASONS } } }),
    ])
    const prefOn = new Set(marketingPrefs.map(p => `${p.userId}:${p.channel}`))
    const channelUsers = new Set(channelAccounts.map(a => a.userId))
    const suppUsers = new Set(activeSuppressions.map(s => s.userId).filter(Boolean) as string[])
    const suppEmails = new Set(activeSuppressions.map(s => s.email.toLowerCase()))

    const users = await db.user.findMany({ where: { status: "ACTIVE" }, take: 500 })
    let queued = 0, skipped = 0, capped = 0
    for (const u of users) {
      const optedIn = optInEmail.has(u.id) || channelUsers.has(u.id)
      if (segment.optInOnly !== false && !optedIn) { skipped++; continue }
      if (suppUsers.has(u.id) || suppEmails.has(u.email.toLowerCase())) { skipped++; continue }

      // EMAIL leg (legacy consent path — requires explicit EMAIL MARKETING pref)
      if (optInEmail.has(u.id)) {
        const token = `unsub_${u.id.slice(-12)}${Date.now().toString(36)}`
        await db.campaignRecipient.create({ data: { campaignId: c.id, userId: u.id, email: u.email, status: "QUEUED" } })
        await db.emailOutbox.create({
          data: {
            toEmail: u.email, userId: u.id, subject: `Tengasell: ${c.name}`,
            body: `Marketing message from campaign "${c.name}". Unsubscribe: /api/comms/unsub?token=${token}`,
            templateKey: c.templateKey, campaignId: c.id, kind: "MARKETING", unsubToken: token, channel: "EMAIL",
          },
        })
        // pending token registry — NOT active suppression (fixes false-suppress bug)
        await db.suppression.create({ data: { userId: u.id, email: u.email, reason: "UNSUB_TOKEN", token } }).catch(() => undefined)
        queued++
      }

      // Linked channel legs — each gated by: LINKED + double opt-in + per-channel MARKETING pref + 24h frequency cap
      for (const a of channelAccounts.filter(x => x.userId === u.id)) {
        if (!prefOn.has(`${u.id}:${a.channel}`)) continue
        if (a.lastMarketingAt && Date.now() - a.lastMarketingAt.getTime() < DAY_MS) {
          await db.campaignRecipient.create({ data: { campaignId: c.id, userId: u.id, email: a.handle, status: "RATE_CAPPED" } }).catch(() => undefined)
          await db.emailOutbox.create({
            data: {
              toEmail: a.handle, userId: u.id, subject: `Tengasell: ${c.name}`,
              body: `Marketing message from campaign "${c.name}" on ${a.channel}. Unsubscribe: /api/comms/unsub?token=${a.unsubToken}`,
              templateKey: c.templateKey, campaignId: c.id, kind: "MARKETING", unsubToken: a.unsubToken,
              channel: a.channel, channelAccountId: a.id, status: "RATE_CAPPED",
            },
          }).catch(() => undefined)
          capped++
          continue
        }
        await db.campaignRecipient.create({ data: { campaignId: c.id, userId: u.id, email: a.handle, status: "QUEUED" } })
        await db.emailOutbox.create({
          data: {
            toEmail: a.handle, userId: u.id, subject: `Tengasell: ${c.name}`,
            body: `Marketing message from campaign "${c.name}" on ${a.channel}. Unsubscribe: /api/comms/unsub?token=${a.unsubToken}`,
            templateKey: c.templateKey, campaignId: c.id, kind: "MARKETING", unsubToken: a.unsubToken,
            channel: a.channel, channelAccountId: a.id,
          },
        })
        queued++
      }
    }
    await db.campaign.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date(), stats: JSON.stringify({ queued, sent: 0, suppressed: skipped, rateCapped: capped }) } })
  }
}

export async function publishScheduledArticles() {
  const due = await db.article.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } }, take: 10 })
  for (const a of due) {
    await db.article.update({ where: { id: a.id }, data: { status: "PUBLISHED", publishedAt: new Date() } })
  }
}

export async function processWebhookRetries() {
  const due = await db.webhookDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextRetryAt: { lte: new Date() } }, take: 10 })
  for (const d of due) {
    const attempts = d.attempts + 1
    if (attempts >= 5) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "DEAD", attempts, lastAttemptAt: new Date(), responseCode: -1 } })
      continue
    }
    // Mock delivery: alternate 2xx / 5xx by parity to exercise the retry+DLQ path
    const code = attempts % 2 === 0 ? 200 : 500
    const status = code === 200 ? "DELIVERED" : "FAILED"
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status, attempts, lastAttemptAt: new Date(), responseCode: code, nextRetryAt: new Date(Date.now() + Math.pow(2, attempts) * 60000) } })
  }
}

export async function rollupMetrics() {
  const today = new Date().toISOString().slice(0, 10)
  const existing = await db.metricDaily.findUnique({ where: { date: today } })
  if (existing) return
  const midnight = new Date(today + "T00:00:00Z")
  const [orders, users, listings, bids, disputes, tickets] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: midnight } } }),
    db.user.count(),
    db.listing.count({ where: { status: "ACTIVE" } }),
    db.bid.count({ where: { createdAt: { gte: midnight } } }),
    db.dispute.count({ where: { openedAt: { gte: midnight } } }),
    db.ticket.count({ where: { createdAt: { gte: midnight } } }),
  ])
  const agg = await db.order.aggregate({ where: { createdAt: { gte: midnight }, status: { notIn: ["CANCELLED"] } }, _sum: { totalCharged: true } })
  const newUsers = await db.user.count({ where: { createdAt: { gte: midnight } } })
  await db.metricDaily.create({
    data: {
      date: today, gmv: agg._sum.totalCharged || 0, orders, users, newUsers,
      activeListings: listings, bids, disputes, tickets,
      availabilityPct: 99.9, latencyP95Ms: 180, errorRate: 0.2,
    },
  }).catch(() => undefined)
}

export async function runBackup(kind: "SCHEDULED" | "MANUAL" = "SCHEDULED") {
  const fs = await import("fs")
  const path = await import("path")
  const crypto = await import("crypto")
  const dbFile = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "db/custom.db")
  try {
    const stat = fs.statSync(dbFile)
    const buf = fs.readFileSync(dbFile)
    const checksum = crypto.createHash("sha256").update(buf).digest("hex")
    const backupDir = path.join(process.cwd(), "db/backups")
    fs.mkdirSync(backupDir, { recursive: true })
    const storageRef = `db/backups/tengasell-${new Date().toISOString().replace(/[:.]/g, "-")}.db`
    fs.copyFileSync(dbFile, path.join(process.cwd(), storageRef))
    const run = await db.backupRun.create({
      data: { kind, scope: "full", sizeBytes: stat.size, checksum, status: "OK", storageRef, verifiedAt: new Date() },
    })
    await db.appLog.create({ data: { level: "info", source: "scheduler", message: `backup-ok ${run.id}`, context: JSON.stringify({ checksum, storageRef }) } })
    return run
  } catch (e) {
    await db.backupRun.create({ data: { kind, scope: "full", status: "FAILED" } })
    await db.appLog.create({ data: { level: "error", source: "scheduler", message: "backup-failed" } })
    return null
  }
}

export async function tick() {
  try {
    await endExpiredAuctions()
    await dispatchOutbox()
    await sendDueCampaigns()
    await publishScheduledArticles()
    await processWebhookRetries()
    await rollupMetrics()
    const last = g.__tgsLastBackup || 0
    if (Date.now() - last > 24 * 3600 * 1000) {
      g.__tgsLastBackup = Date.now()
      await runBackup("SCHEDULED")
    }
  } catch (e) {
    try {
      await db.appLog.create({ data: { level: "error", source: "scheduler", message: `tick-error ${(e as Error).message}` } })
    } catch { /* noop */ }
  }
}

export function startScheduler() {
  if (g.__tgsScheduler) return
  g.__tgsScheduler = setInterval(() => { tick() }, 60_000)
  setTimeout(() => { tick() }, 8_000)
}
