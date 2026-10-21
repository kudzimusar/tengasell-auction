// /api/admin/refunds — GET queue (SUPPORT+FINANCE) · POST create refund request → dual approval (CTL-021)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, paginate, parseBody, audit } from "@/lib/server/api"
import { guard, ORDER_ROLES, round2, notify, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

// ── GET /api/admin/refunds?status ───────────────────────────────
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(ORDER_ROLES, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status

  try {
    const [rows, total] = await Promise.all([
      db.refund.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.refund.count({ where }),
    ])
    const orderIds = [...new Set(rows.map((r) => r.orderId))]
    const orders = orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } } }) : []
    const listingIds = [...new Set(orders.map((o) => o.listingId))]
    const [listings, users] = await Promise.all([
      listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true } }) : [],
      userMap(rows.map((r) => r.requestedBy)),
    ])
    const orderM = new Map(orders.map((o) => [o.id, o]))
    const listingM = new Map(listings.map((l) => [l.id, l.title]))

    // Link the approval request for each refund (payload.refundId)
    const approvals = await db.approvalRequest.findMany({ where: { type: "REFUND" }, orderBy: { createdAt: "desc" } })
    const approvalByRefund = new Map<string, { status: string; id: string }>()
    for (const ap of approvals) {
      try {
        const p = JSON.parse(ap.payload || "{}") as { refundId?: string }
        if (p.refundId) approvalByRefund.set(p.refundId, { status: ap.status, id: ap.id })
      } catch { /* skip */ }
    }

    const items = rows.map((r) => {
      const order = orderM.get(r.orderId)
      const listing = order ? listingM.get(order.listingId) : null
      const ap = approvalByRefund.get(r.id)
      return {
        ...r,
        listingTitle: listing || null,
        orderTotal: order ? order.totalCharged : null,
        requestedByName: users.get(r.requestedBy)?.name || null,
        approvalStatus: ap?.status || null,
        approvalId: ap?.id || null,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}

// ── POST /api/admin/refunds {orderId, amount, type, reasonCode} ──
const createSchema = z.object({
  orderId: z.string().trim().min(5).max(60),
  amount: z.number().positive().max(1_000_000),
  type: z.enum(["FULL", "PARTIAL"]).default("FULL"),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(ORDER_ROLES, requestId)
  if (!user) return res

  const { data, error: bodyErr } = await parseBody(req, createSchema)
  if (bodyErr) return bodyErr

  try {
    const order = await db.order.findUnique({ where: { id: data.orderId } })
    if (!order) return fail("Order not found", 404, requestId)
    if (["PENDING_PAYMENT", "CANCELLED", "REFUNDED"].includes(order.status)) {
      return fail(`Order in status ${order.status} cannot be refunded`, 422, requestId)
    }
    const total = round2(order.totalCharged || order.amount)
    const amount = round2(data.type === "FULL" ? total : data.amount)
    if (amount <= 0 || amount > total) {
      return fail(`Refund amount must be between $0 and ${total}`, 422, requestId)
    }
    const dup = await db.refund.findFirst({
      where: { orderId: order.id, status: { in: ["REQUESTED", "APPROVED"] } },
    })
    if (dup) return fail("A refund request is already open for this order", 409, requestId)

    const reason = `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`
    const refund = await db.refund.create({
      data: {
        orderId: order.id, amount, type: data.type, reason: data.reasonCode,
        status: "REQUESTED", requestedBy: user.id,
      },
    })

    // Dual approval (CTL-021): a second, different staff member approves
    const approval = await db.approvalRequest.create({
      data: {
        type: "REFUND",
        payload: JSON.stringify({
          refundId: refund.id, orderId: order.id, amount, type: data.type,
          reasonCode: data.reasonCode, note: data.note || null, orderTotal: total,
        }),
        requestedBy: user.id, status: "PENDING",
      },
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: "refund.request", targetType: "REFUND", targetId: refund.id,
      before: { orderStatus: order.status },
      after: { refundId: refund.id, amount, type: data.type, approvalId: approval.id, status: "REQUESTED" },
      reason, requestId, ip,
    })
    return ok({ refundId: refund.id, approvalId: approval.id, status: refund.status, amount }, requestId, 201)
  } catch {
    return fail("Could not create refund request", 500, requestId)
  }
}
