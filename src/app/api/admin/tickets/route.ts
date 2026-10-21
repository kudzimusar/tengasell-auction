// GET /api/admin/tickets — SLA-aware support queue (SUPPORT+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, STAFF_PLUS, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined
  const q = (sp.get("q") || "").trim().slice(0, 120)

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  if (q) where.OR = [{ subject: { contains: q } }, { userId: { contains: q } }]

  try {
    const [rows, total, now] = await Promise.all([
      db.ticket.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.ticket.count({ where }),
      Promise.resolve(new Date()),
    ])
    const users = await userMap(rows.map((r) => r.userId).concat(rows.map((r) => r.assignedTo || "").filter(Boolean)))

    const items = rows.map((t) => ({
      ...t,
      userName: users.get(t.userId)?.name || null,
      userEmail: users.get(t.userId)?.email || null,
      assignedToName: t.assignedTo ? users.get(t.assignedTo)?.name || null : null,
      slaBreached: t.slaDueAt ? t.slaDueAt < now && t.status !== "CLOSED" : false,
    }))
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
