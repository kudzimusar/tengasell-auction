// ── Tengasell marketplace shared server helpers (Agent A) ──
// Private folder (_lib) — not routable. Used by listings/orders/sellers/reviews routes.
import { createHmac } from "crypto"
import { db } from "@/lib/db"
import { sha256 } from "@/lib/server/auth-core"
import { json } from "@/lib/server/api"

export const PUBLIC_LISTING_STATUSES = ["ACTIVE", "ENDED", "SOLD"] as const

// ── Config / feature flags ────────────────────────────────────
export const DEFAULT_SETTINGS = { vat_rate: 15, seller_fee_pct: 5, buyer_fee_pct: 0, bid_increment: 1 }

export type MktSettings = {
  vatRate: number
  sellerFeePct: number
  buyerFeePct: number
  bidIncrement: number
}

export async function getSettings(): Promise<MktSettings> {
  const rows = await db.configSetting.findMany({ where: { key: { in: Object.keys(DEFAULT_SETTINGS) } } })
  const m = new Map(rows.map(r => [r.key, json(r.value, 0)]))
  const num = (k: string, d: number) => {
    const v = m.get(k)
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d
  }
  return {
    vatRate: num("vat_rate", DEFAULT_SETTINGS.vat_rate),
    sellerFeePct: num("seller_fee_pct", DEFAULT_SETTINGS.seller_fee_pct),
    buyerFeePct: num("buyer_fee_pct", DEFAULT_SETTINGS.buyer_fee_pct),
    bidIncrement: num("bid_increment", DEFAULT_SETTINGS.bid_increment),
  }
}

export async function flagEnabled(key: string, fallback = false): Promise<boolean> {
  const f = await db.featureFlag.findUnique({ where: { key } })
  return f ? f.enabled : fallback
}

// ── Money (2-decimal rounding everywhere) ─────────────────────
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function calcFees(amount: number, s: MktSettings) {
  const buyerFee = round2((amount * s.buyerFeePct) / 100)
  const sellerFee = round2((amount * s.sellerFeePct) / 100)
  const vat = round2((amount * s.vatRate) / 100)
  const totalCharged = round2(amount + buyerFee)
  const sellerProceeds = round2(amount - sellerFee - vat)
  return { buyerFee, sellerFee, vat, totalCharged, sellerProceeds }
}

// ── Privacy helpers ──────────────────────────────────────────
// Anonymise a bidder display name: "Tariro" → "T***o"
export function anonName(name: string): string {
  const n = (name || "").trim()
  if (!n) return "b***r"
  if (n.length <= 2) return `${n[0]}***`
  return `${n[0]}***${n[n.length - 1]}`
}

// ── Comms helpers (notifications, templated outbox, webhooks) ─
export async function notify(userId: string, type: string, params: Record<string, unknown>) {
  try {
    await db.notification.create({ data: { userId, type, params: JSON.stringify(params) } })
  } catch { /* non-fatal */ }
}

export function renderTemplate(tpl: { subjectEn: string; subjectJa: string; bodyEn: string; bodyJa: string } | null, vars: Record<string, string>, locale: string) {
  if (!tpl) return null
  const subject = (locale === "ja" ? tpl.subjectJa : tpl.subjectEn) || tpl.subjectEn
  const body = (locale === "ja" ? tpl.bodyJa : tpl.bodyEn) || tpl.bodyEn
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "")
  return { subject: fill(subject), body: fill(body) }
}

export async function queueOutbox(input: { toEmail: string; userId?: string; subject: string; body: string; templateKey: string }) {
  try {
    await db.emailOutbox.create({
      data: {
        toEmail: input.toEmail,
        userId: input.userId ?? undefined,
        subject: input.subject,
        body: input.body,
        templateKey: input.templateKey,
        kind: "TRANSACTIONAL",
      },
    })
  } catch { /* non-fatal */ }
}

// Render a seeded Template by key + queue to outbox. Falls back to plain strings.
export async function sendTemplatedEmail(input: {
  templateKey: string
  toUser: { id: string; email: string; name: string; locale: string }
  vars: Record<string, string>
  fallbackSubject: string
  fallbackBody: string
}) {
  const tpl = await db.template.findUnique({ where: { key: input.templateKey } })
  const rendered = renderTemplate(tpl, input.vars, input.toUser.locale)
  await queueOutbox({
    toEmail: input.toUser.email,
    userId: input.toUser.id,
    subject: rendered?.subject ?? input.fallbackSubject,
    body: (rendered?.body ?? input.fallbackBody).slice(0, 4000),
    templateKey: input.templateKey,
  })
}

// Create PENDING WebhookDelivery rows for every ACTIVE endpoint of this user subscribed to the event.
export async function dispatchWebhook(userId: string, event: string, payload: Record<string, unknown>) {
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { userId, status: "ACTIVE" } })
    for (const ep of endpoints) {
      const events = json(ep.events, [] as string[])
      if (!events.includes(event)) continue
      const bodyStr = JSON.stringify({ event, ts: new Date().toISOString(), ...payload })
      const sig = "sha256=" + createHmac("sha256", ep.secret).update(bodyStr).digest("hex")
      await db.webhookDelivery.create({
        data: { endpointId: ep.id, event, payload: bodyStr, signature: sig, status: "PENDING", nextRetryAt: new Date() },
      })
    }
  } catch { /* non-fatal */ }
}

// ── Sequential invoice numbers: INV-YYYY-#### ──────────────────
export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const count = await db.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } })
  return `INV-${year}-${String(count + 1).padStart(4, "0")}`
}

// ── Payment capture pipeline (order PENDING_PAYMENT → PAID) ──
// Shared by PATCH /api/orders/[id] action "pay" (and any capture re-entry).
export async function captureOrderPayment(input: {
  orderId: string
  method?: string
  actorId: string
  actorRole?: string
  requestId?: string
  ip?: string
}): Promise<{ ok: true; order: { id: string; status: string; totalCharged: number } } | { ok: false; error: string; code: number }> {
  const order = await db.order.findUnique({ where: { id: input.orderId } })
  if (!order) return { ok: false, error: "Order not found", code: 404 }
  if (order.status !== "PENDING_PAYMENT") return { ok: false, error: "Order is not awaiting payment", code: 409 }

  const listing = await db.listing.findUnique({ where: { id: order.listingId } })
  if (!listing) return { ok: false, error: "Listing no longer exists", code: 404 }
  const settings = await getSettings()

  // Fees stored at placement; compute fresh if this order skipped fee computation (e.g. auction auto-close)
  const fees =
    order.sellerFee > 0 || order.vatAmount > 0
      ? { buyerFee: round2(order.buyerFee), sellerFee: round2(order.sellerFee), vat: round2(order.vatAmount), totalCharged: round2(order.totalCharged || order.amount + order.buyerFee) }
      : calcFees(order.amount, settings)

  const method = input.method || order.paymentMethod || "MOCK_CARD"
  const now = new Date()

  // Mock two-phase payment: AUTHORIZED (placed at checkout) → CAPTURED
  let payment = await db.payment.findFirst({ where: { orderId: order.id, status: "AUTHORIZED" }, orderBy: { createdAt: "desc" } })
  if (!payment) {
    payment = await db.payment.create({
      data: {
        orderId: order.id, method, status: "AUTHORIZED", authRef: `auth_${sha256(order.id + method).slice(0, 12)}`,
        amount: fees.totalCharged, idempotencyKey: `pay-${order.id}-${Date.now()}`,
      },
    })
  }
  const paymentId = payment.id
  await db.payment.update({ where: { id: paymentId }, data: { status: "CAPTURED", captureRef: `cap_${paymentId.slice(-10)}`, updatedAt: now } })

  // Core state change (atomic): order → PAID + double-entry ledger + tax line
  const updated = await db.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID", paidAt: now, paymentMethod: method,
        buyerFee: fees.buyerFee, sellerFee: fees.sellerFee, vatAmount: fees.vat, totalCharged: fees.totalCharged,
      },
    })
    await tx.orderEvent.create({ data: { orderId: order.id, type: "PAID", actorId: input.actorId, data: JSON.stringify({ method, amount: fees.totalCharged, paymentId }) } })
    // Double-entry ledger (FIN): debits == credits
    await tx.ledgerEntry.create({ data: { orderRef: order.id, account: "BUYER_PAYMENTS", direction: "DEBIT", amount: fees.totalCharged, memo: "Payment captured (mock)", refs: JSON.stringify({ orderId: order.id, paymentId }) } })
    await tx.ledgerEntry.create({ data: { orderRef: order.id, account: "SELLER_PAYABLE", direction: "CREDIT", amount: fees.totalCharged - fees.sellerFee - fees.vat, memo: "Seller proceeds net of commission+VAT", refs: JSON.stringify({ orderId: order.id, sellerId: order.sellerId }) } })
    await tx.ledgerEntry.create({ data: { orderRef: order.id, account: "PLATFORM_REVENUE", direction: "CREDIT", amount: fees.sellerFee, memo: `Commission ${settings.sellerFeePct}%`, refs: JSON.stringify({ orderId: order.id }) } })
    await tx.ledgerEntry.create({ data: { orderRef: order.id, account: "VAT_PAYABLE", direction: "CREDIT", amount: fees.vat, memo: `VAT ${settings.vatRate}% (ZIMRA)`, refs: JSON.stringify({ orderId: order.id }) } })
    await tx.taxLine.create({ data: { orderId: order.id, kind: "VAT", rate: settings.vatRate, amount: fees.vat, jurisdiction: "ZW" } })
    return o
  })

  // Invoice (sequential number)
  try {
    const number = await nextInvoiceNumber()
    await db.invoice.create({
      data: {
        number, orderId: order.id, toUserId: order.buyerId, kind: "SALE",
        lines: JSON.stringify([{ label: listing.title, amount: round2(order.amount) }, ...(fees.buyerFee > 0 ? [{ label: "Buyer fee", amount: fees.buyerFee }] : [])]),
        total: fees.totalCharged, vatAmount: fees.vat,
      },
    })
  } catch { /* non-fatal */ }

  // Notifications + templated email + webhook (best-effort side effects)
  const [buyer, seller] = await Promise.all([
    db.user.findUnique({ where: { id: order.buyerId } }),
    db.user.findUnique({ where: { id: order.sellerId } }),
  ])
  if (buyer) await notify(buyer.id, "ORDER", { orderId: order.id, listingId: listing.id, title: listing.title, amount: fees.totalCharged, side: "buyer" })
  if (seller) await notify(seller.id, "ORDER", { orderId: order.id, listingId: listing.id, title: listing.title, amount: fees.totalCharged, side: "seller" })
  if (buyer) {
    await sendTemplatedEmail({
      templateKey: "order_paid",
      toUser: buyer,
      vars: { name: buyer.name, title: listing.title, amount: `$${fees.totalCharged.toFixed(2)}`, orderId: order.id.slice(-6) },
      fallbackSubject: `Payment received for ${listing.title}`,
      fallbackBody: `We received your payment of $${fees.totalCharged.toFixed(2)} for "${listing.title}".`,
    })
  }
  await dispatchWebhook(order.sellerId, "order.paid", { orderId: order.id, listingId: listing.id, title: listing.title, amount: fees.totalCharged })

  const { audit } = await import("@/lib/server/api")
  await audit({ actorId: input.actorId, actorRole: input.actorRole, action: "order.pay", targetType: "ORDER", targetId: order.id, after: { status: "PAID", totalCharged: fees.totalCharged, paymentId }, requestId: input.requestId, ip: input.ip })

  return { ok: true, order: { id: updated.id, status: updated.status, totalCharged: updated.totalCharged } }
}
