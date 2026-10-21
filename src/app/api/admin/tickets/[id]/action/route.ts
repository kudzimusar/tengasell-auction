// POST /api/admin/tickets/[id]/action — ASSIGN | CLOSE (SUPPORT+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, STAFF_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["ASSIGN", "CLOSE"]),
  assignTo: z.string().trim().max(60).optional(),
  satisfaction: z.number().int().min(1).max(5).optional(),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const t = await db.ticket.findUnique({ where: { id } })
    if (!t) return fail("Ticket not found", 404, requestId)
    const now = new Date()
    const before = { status: t.status, assignedTo: t.assignedTo, satisfaction: t.satisfaction ?? null }

    if (data.action === "ASSIGN") {
      if (!data.assignTo) return fail("assignTo is required", 422, requestId)
      const assignee = await db.user.findUnique({ where: { id: data.assignTo } })
      if (!assignee) return fail("Assignee not found", 404, requestId)
      if (t.status === "CLOSED") return fail("Ticket is closed", 422, requestId)
      const updated = await db.ticket.update({
        where: { id: t.id },
        data: { assignedTo: assignee.id, status: "IN_PROGRESS", updatedAt: now },
      })
      await audit({
        actorId: user.id, actorRole: user.role, action: "ticket.assign", targetType: "TICKET", targetId: t.id,
        before, after: { status: updated.status, assignedTo: updated.assignedTo },
        reason: data.note || `assigned to ${assignee.name}`, requestId, ip,
      })
      return ok({ status: updated.status, assignedTo: updated.assignedTo }, requestId)
    }

    // CLOSE
    if (t.status === "CLOSED") return fail("Ticket already closed", 422, requestId)
    const updated = await db.ticket.update({
      where: { id: t.id },
      data: { status: "CLOSED", resolvedAt: now, satisfaction: data.satisfaction ?? t.satisfaction, updatedAt: now },
    })
    await notify(t.userId, "TICKET_CLOSED", { ticketId: t.id, subject: t.subject, satisfaction: data.satisfaction ?? null })
    await audit({
      actorId: user.id, actorRole: user.role, action: "ticket.close", targetType: "TICKET", targetId: t.id,
      before, after: { status: updated.status, satisfaction: updated.satisfaction ?? null },
      reason: data.note, requestId, ip,
    })
    return ok({ status: updated.status, satisfaction: updated.satisfaction ?? null }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
