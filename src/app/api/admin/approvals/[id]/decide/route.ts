// POST /api/admin/approvals/[id]/decide — dual-control decision + effect execution (CTL-021)
// Role gates by type: REFUND|PAYOUT → FINANCE+ADMIN · CONFIG → ADMIN · ARTICLE_PUBLISH → COMPLIANCE+ADMIN
// The decider must be a DIFFERENT staff member than the requester.
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { Role } from "@/lib/server/auth-core"
import { guard, round2, notify, FINANCE_ROLES, ADMIN_ONLY, CMS_ROLES } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
})

const TYPE_ROLES: Record<string, Role[]> = {
  REFUND: FINANCE_ROLES,
  PAYOUT: FINANCE_ROLES,
  CONFIG: ADMIN_ONLY,
  ARTICLE_PUBLISH: CMS_ROLES,
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params

  // Peek at the approval first to apply the per-type role gate
  let approval: { id: string; type: string; status: string; requestedBy: string; payload: string } | null = null
  try {
    approval = await db.approvalRequest.findUnique({ where: { id } })
  } catch {
    return fail("Decision failed", 500, requestId)
  }
  if (!approval) return fail("Approval request not found", 404, requestId)
  const roles = TYPE_ROLES[approval.type]
  if (!roles) return fail(`Unknown approval type ${approval.type}`, 422, requestId)

  const { user, res } = await guard(roles, requestId)
  if (!user) return res

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr
  if (data.decision === "REJECTED" && (!data.note || data.note.trim().length < 3)) {
    return fail("A note is required when rejecting", 422, requestId)
  }

  // ── Dual control invariants (CTL-021) ──
  if (approval.status !== "PENDING") return fail(`Request already ${approval.status.toLowerCase()}`, 409, requestId)
  if (approval.requestedBy === user.id) {
    return fail("Dual control: you cannot approve your own request — a different staff member must decide", 422, requestId)
  }

  const now = new Date()
  const payload = json<{ refundId?: string; payoutId?: string; key?: string; value?: unknown }>(approval.payload, {})
  const note = data.note || ""

  try {
    const decided = await db.approvalRequest.update({
      where: { id: approval.id },
      data: { status: data.decision, decidedBy: user.id, decidedAt: now, reason: note || null },
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: `approval.${data.decision.toLowerCase()}`, targetType: "APPROVAL", targetId: approval.id,
      before: { status: "PENDING", type: approval.type, requestedBy: approval.requestedBy, payload },
      after: { status: data.decision, decidedBy: user.id },
      reason: note || `${data.decision} ${approval.type}`, requestId, ip,
    })

    // ── Effect execution ──
    if (data.decision === "REJECTED") {
      if (approval.type === "REFUND" && payload.refundId) {
        await db.refund.update({ where: { id: payload.refundId }, data: { status: "REJECTED" } }).catch(() => undefined)
      }
      if (approval.type === "PAYOUT" && payload.payoutId) {
        await db.payout.update({
          where: { id: payload.payoutId },
          data: { status: "FAILED", failedReason: note || "Rejected by approver" },
        }).catch(() => undefined)
      }
      return ok({ status: decided.status, executed: false }, requestId)
    }

    if (approval.type === "REFUND" && payload.refundId) {
      const executed = await executeRefund(payload.refundId, user, note, requestId, ip)
      if (!executed.ok) return fail(executed.error, executed.code, requestId)
      return ok({ status: decided.status, executed: true, effect: "REFUND_PROCESSED" }, requestId)
    }

    if (approval.type === "PAYOUT" && payload.payoutId) {
      const executed = await executePayout(payload.payoutId, user, note, requestId, ip)
      if (!executed.ok) return fail(executed.error, executed.code, requestId)
      return ok({ status: decided.status, executed: true, effect: "PAYOUT_PAID" }, requestId)
    }

    if (approval.type === "CONFIG" && payload.key) {
      const before = await db.configSetting.findUnique({ where: { key: payload.key } })
      await db.configSetting.update({
        where: { key: payload.key },
        data: { value: JSON.stringify(payload.value ?? null), updatedBy: user.email },
      })
      await audit({
        actorId: user.id, actorRole: user.role, action: "config.apply", targetType: "CONFIG", targetId: payload.key,
        before: { value: before?.value }, after: { value: JSON.stringify(payload.value ?? null) },
        reason: note || `config change approved (${approval.id})`, requestId, ip,
      })
      return ok({ status: decided.status, executed: true, effect: "CONFIG_APPLIED", key: payload.key }, requestId)
    }

    // ARTICLE_PUBLISH or payloads without links: decision recorded only
    return ok({ status: decided.status, executed: true }, requestId)
  } catch {
    return fail("Decision failed", 500, requestId)
  }
}

// ── REFUND effect: Refund→PROCESSED, Order→REFUNDED, Payment→REVERSED, balanced ledger reversal ──
async function executeRefund(
  refundId: string, approver: { id: string; role: string; email?: string }, note: string, requestId: string, ip: string,
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const refund = await db.refund.findUnique({ where: { id: refundId } })
  if (!refund) return { ok: false, error: "Refund record missing", code: 404 }
  const order = await db.order.findUnique({ where: { id: refund.orderId } })
  if (!order) return { ok: false, error: "Order for refund is missing", code: 404 }
  if (refund.status === "PROCESSED") return { ok: false, error: "Refund already processed", code: 409 }

  const now = new Date()
  const total = round2(order.totalCharged || order.amount)
  const amount = round2(refund.amount)
  const reversalRef = `rvrf_${refund.id.slice(-10)}`
  const full = refund.type === "FULL" || amount >= total

  // Split reversal components (fee/vat are reversed alongside the principal; balanced to the penny)
  const feeRev = full ? round2(order.sellerFee) : round2((round2(order.sellerFee) * amount) / total)
  const vatRev = full ? round2(order.vatAmount) : round2((round2(order.vatAmount) * amount) / total)
  const proceedsRev = round2(amount - feeRev - vatRev) // seller payable reversal

  const updated = await db.refund.update({
    where: { id: refund.id },
    data: { status: "PROCESSED", approvedBy: approver.id, processedAt: now, reversalRef },
  })
  const before = { orderStatus: order.status, refundStatus: refund.status }

  await db.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } })
  await db.orderEvent.create({
    data: {
      orderId: order.id, type: "REFUNDED", actorId: approver.id,
      data: JSON.stringify({ refundId: refund.id, amount, reversalRef }),
    },
  })
  await db.payment.updateMany({
    where: { orderId: order.id, status: "CAPTURED" },
    data: { status: "REVERSED", updatedAt: now },
  })
  // Tax lines become non-remittable when the sale is reversed
  await db.taxLine.updateMany({ where: { orderId: order.id }, data: { remitted: false } })

  // Balanced ledger reversal:
  // Pair A — money leaves the platform back to the buyer:
  //   BUYER_REFUNDS (DR amount) / BUYER_PAYMENTS (CR amount)
  // Pair B — reverse the original internal split, clawed into the refunds bucket:
  //   SELLER_PAYABLE (DR proceedsRev), PLATFORM_REVENUE (DR feeRev), VAT_PAYABLE (DR vatRev) / BUYER_REFUNDS (CR amount)
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "BUYER_REFUNDS", direction: "DEBIT", amount, memo: `Refund to buyer ${reversalRef}`, refs: JSON.stringify({ orderId: order.id, refundId: refund.id, buyerId: order.buyerId }) } })
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "BUYER_PAYMENTS", direction: "CREDIT", amount, memo: `Refund paid out ${reversalRef}`, refs: JSON.stringify({ orderId: order.id, refundId: refund.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "SELLER_PAYABLE", direction: "DEBIT", amount: proceedsRev, memo: "Reversal: seller payable clawed back (net of commission+VAT)", refs: JSON.stringify({ orderId: order.id, refundId: refund.id, sellerId: order.sellerId }) } })
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "PLATFORM_REVENUE", direction: "DEBIT", amount: feeRev, memo: "Reversal: commission refunded", refs: JSON.stringify({ orderId: order.id, refundId: refund.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "VAT_PAYABLE", direction: "DEBIT", amount: vatRev, memo: "Reversal: VAT liability released", refs: JSON.stringify({ orderId: order.id, refundId: refund.id }) } })
  await db.ledgerEntry.create({ data: { orderRef: order.id, account: "BUYER_REFUNDS", direction: "CREDIT", amount, memo: `Split reversal recovered ${reversalRef}`, refs: JSON.stringify({ orderId: order.id, refundId: refund.id }) } })

  await notify(order.buyerId, "REFUND", { orderId: order.id, refundId: refund.id, amount, reversalRef })
  await notify(order.sellerId, "REFUND", { orderId: order.id, refundId: refund.id, amount, side: "seller" })

  await audit({
    actorId: approver.id, actorRole: approver.role, action: "refund.process", targetType: "REFUND", targetId: refund.id,
    before, after: {
      refundStatus: updated.status, orderStatus: "REFUNDED", amount,
      ledger: { BUYER_REFUNDS_DR: amount, BUYER_PAYMENTS_CR: amount, SELLER_PAYABLE_DR: proceedsRev, PLATFORM_REVENUE_DR: feeRev, VAT_PAYABLE_DR: vatRev, BUYER_REFUNDS_CR: amount },
    },
    reason: note || "approved via dual control", requestId, ip,
  })
  return { ok: true }
}

// ── PAYOUT effect: Payout→APPROVED→PAID + batch + ledger (SELLER_PAYABLE DR / PAYOUT_CLEARING CR) ──
async function executePayout(
  payoutId: string, approver: { id: string; role: string }, note: string, requestId: string, ip: string,
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  const payout = await db.payout.findUnique({ where: { id: payoutId } })
  if (!payout) return { ok: false, error: "Payout record missing", code: 404 }
  if (payout.status !== "PENDING") return { ok: false, error: `Payout already ${payout.status}`, code: 409 }

  const now = new Date()
  const batchRef = `BATCH-${now.toISOString().slice(0, 10).replace(/-/g, "")}`
  const updated = await db.payout.update({
    where: { id: payout.id },
    data: {
      status: "PAID", approvedBy: approver.id, processedAt: now, batchRef,
    },
  })

  await db.ledgerEntry.create({ data: { account: "SELLER_PAYABLE", direction: "DEBIT", amount: round2(payout.amount), memo: `Payout to seller ${batchRef}`, refs: JSON.stringify({ payoutId: payout.id, sellerId: payout.sellerId, batchRef }) } })
  await db.ledgerEntry.create({ data: { account: "PAYOUT_CLEARING", direction: "CREDIT", amount: round2(payout.amount), memo: `Payout batch ${batchRef}`, refs: JSON.stringify({ payoutId: payout.id, sellerId: payout.sellerId, batchRef }) } })

  await notify(payout.sellerId, "PAYOUT", { payoutId: payout.id, amount: payout.amount, batchRef })

  await audit({
    actorId: approver.id, actorRole: approver.role, action: "payout.pay", targetType: "PAYOUT", targetId: payout.id,
    before: { status: "PENDING" },
    after: { status: updated.status, batchRef, processedAt: updated.processedAt, amount: payout.amount },
    reason: note || "approved via dual control", requestId, ip,
  })
  return { ok: true }
}
