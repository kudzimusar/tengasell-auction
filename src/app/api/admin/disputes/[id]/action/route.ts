// POST /api/admin/disputes/[id]/action — ASSIGN | RESOLVE (SUPPORT+MODERATOR)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, DISPUTE_ROLES, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["ASSIGN", "RESOLVE"]),
  resolution: z.enum(["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"]).optional(),
  note: z.string().trim().max(2000).optional(),
  assignTo: z.string().trim().max(60).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(DISPUTE_ROLES, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const dispute = await db.dispute.findUnique({ where: { id } })
    if (!dispute) return fail("Dispute not found", 404, requestId)
    const order = await db.order.findUnique({ where: { id: dispute.orderId } })
    if (!order) return fail("Linked order no longer exists", 422, requestId)

    const before = { status: dispute.status, resolution: dispute.resolution, assignedTo: dispute.assignedTo, orderStatus: order.status }
    const now = new Date()

    if (data.action === "ASSIGN") {
      if (!data.assignTo) return fail("assignTo is required", 422, requestId)
      if (["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"].includes(dispute.status)) {
        return fail("Dispute already resolved", 422, requestId)
      }
      const assignee = await db.user.findUnique({ where: { id: data.assignTo } })
      if (!assignee) return fail("Assignee not found", 404, requestId)
      const updated = await db.dispute.update({
        where: { id },
        data: { status: "UNDER_REVIEW", assignedTo: assignee.id },
      })
      await audit({
        actorId: user.id, actorRole: user.role, action: "dispute.assign", targetType: "DISPUTE", targetId: dispute.id,
        before, after: { status: updated.status, assignedTo: updated.assignedTo },
        reason: data.note || `assigned to ${assignee.name}`, requestId, ip,
      })
      return ok({ status: updated.status, assignedTo: updated.assignedTo }, requestId)
    }

    // RESOLVE
    if (!data.resolution) return fail("resolution is required for RESOLVE", 422, requestId)
    if (!data.note || data.note.trim().length < 3) return fail("A decision note is required", 422, requestId)
    if (["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"].includes(dispute.status)) {
      return fail("Dispute already resolved", 422, requestId)
    }

    const updated = await db.dispute.update({
      where: { id },
      data: { status: data.resolution, resolution: data.note, resolvedAt: now },
    })

    // Order state per resolution:
    // RESOLVED_BUYER → REFUND_PENDING (refund raised via finance queue)
    // RESOLVED_SELLER → COMPLETED
    // CLOSED → back to PAID when it was DISPUTED
    let newOrderStatus: string | null = null
    if (data.resolution === "RESOLVED_BUYER") newOrderStatus = "REFUND_PENDING"
    else if (data.resolution === "RESOLVED_SELLER") newOrderStatus = "COMPLETED"
    else if (data.resolution === "CLOSED" && order.status === "DISPUTED") newOrderStatus = "PAID"

    if (newOrderStatus) {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: newOrderStatus,
          ...(newOrderStatus === "COMPLETED" ? { completedAt: now } : {}),
        },
      })
      await db.orderEvent.create({
        data: {
          orderId: order.id, type: `DISPUTE_${data.resolution}`, actorId: user.id,
          data: JSON.stringify({ disputeId: dispute.id, note: data.note }),
        },
      })
    }

    // Notify both parties
    await notify(order.buyerId, "DISPUTE_RESOLVED", { orderId: order.id, disputeId: dispute.id, resolution: data.resolution })
    await notify(order.sellerId, "DISPUTE_RESOLVED", { orderId: order.id, disputeId: dispute.id, resolution: data.resolution })

    await audit({
      actorId: user.id, actorRole: user.role, action: "dispute.resolve", targetType: "DISPUTE", targetId: dispute.id,
      before, after: { status: updated.status, resolution: updated.resolution, orderStatus: newOrderStatus || order.status },
      reason: data.note, requestId, ip,
    })
    return ok({
      status: updated.status,
      orderStatus: newOrderStatus || order.status,
      nextStep: data.resolution === "RESOLVED_BUYER"
        ? "Raise the refund in Finance → Refunds for dual approval."
        : null,
    }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
