// POST /api/admin/tickets/[id]/reply — staff reply or internal note (SUPPORT+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, STAFF_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internal: z.boolean().default(false),
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
    if (t.status === "CLOSED") return fail("Ticket is closed — open a new one", 422, requestId)

    const now = new Date()
    const msg = await db.ticketMessage.create({
      data: {
        ticketId: t.id, authorId: user.id, role: "SUPPORT", body: data.body, internal: data.internal,
      },
    })
    const updated = await db.ticket.update({
      where: { id: t.id },
      data: {
        // first response clock (SLA)
        firstResponseAt: !t.firstResponseAt && !data.internal ? now : t.firstResponseAt,
        status: data.internal ? t.status : (t.status === "OPEN" ? "IN_PROGRESS" : t.status),
        updatedAt: now,
      },
    })

    if (!data.internal) {
      await notify(t.userId, "TICKET_REPLY", { ticketId: t.id, subject: t.subject })
    }

    await audit({
      actorId: user.id, actorRole: user.role,
      action: data.internal ? "ticket.internal_note" : "ticket.reply",
      targetType: "TICKET", targetId: t.id,
      before: { status: t.status, firstResponseAt: t.firstResponseAt },
      after: { status: updated.status, firstResponseAt: updated.firstResponseAt, messageId: msg.id },
      requestId, ip,
    })
    return ok({ messageId: msg.id, internal: data.internal }, requestId)
  } catch {
    return fail("Reply failed", 500, requestId)
  }
}
