// GET /api/admin/tickets/[id] — ticket + message thread (SUPPORT+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"
import { guard, STAFF_PLUS } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  try {
    const t = await db.ticket.findUnique({ where: { id } })
    if (!t) return fail("Ticket not found", 404, requestId)
    const messages = await db.ticketMessage.findMany({ where: { ticketId: id }, orderBy: { createdAt: "asc" } })
    const [owner] = t.userId ? await db.user.findMany({ where: { id: t.userId }, select: { id: true, name: true, email: true } }) : []

    const authorIds = messages.map((m) => m.authorId).filter(Boolean) as string[]
    const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : []
    const authorM = new Map(authors.map((a) => [a.id, a]))

    const now = new Date()
    return ok({
      ticket: {
        ...t,
        userName: owner?.name || null,
        userEmail: owner?.email || null,
        slaBreached: t.slaDueAt ? t.slaDueAt < now && t.status !== "CLOSED" : false,
      },
      messages: messages.map((m) => ({ ...m, authorName: m.authorId ? authorM.get(m.authorId)?.name || null : null })),
    }, requestId)
  } catch {
    return fail("Could not load ticket", 500, requestId)
  }
}
