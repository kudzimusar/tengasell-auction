// GET /api/admin/appeals — appeal queue (MODERATOR+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, MOD_PLUS, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status

  try {
    const [rows, total] = await Promise.all([
      db.appeal.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.appeal.count({ where }),
    ])
    const users = await userMap(rows.map((r) => r.userId))
    const enforcements = await db.enforcement.findMany({ where: { id: { in: rows.map((r) => r.enforcementId) } } })
    const enfM = new Map(enforcements.map((e) => [e.id, e]))

    const items = rows.map((a) => ({
      ...a,
      userName: users.get(a.userId)?.name || null,
      enforcement: enfM.get(a.enforcementId) || null,
    }))
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
