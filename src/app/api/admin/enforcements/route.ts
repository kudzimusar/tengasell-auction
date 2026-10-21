// GET /api/admin/enforcements — ladder history (MODERATOR+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, MOD_PLUS, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res

  const { limit, page, skip } = paginate(req.nextUrl.searchParams)

  try {
    const [rows, total] = await Promise.all([
      db.enforcement.findMany({ orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.enforcement.count(),
    ])
    const users = await userMap(rows.flatMap((r) => [r.userId, r.issuedBy]))

    const items = rows.map((e) => ({
      ...e,
      userName: users.get(e.userId)?.name || null,
      userEmail: users.get(e.userId)?.email || null,
      userStatus: undefined,
      issuedByName: users.get(e.issuedBy)?.name || null,
    }))
    // Fetch live statuses (users map has no status selected; do a light pass)
    const statusRows = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, status: true },
    })
    const statusM = new Map(statusRows.map((s) => [s.id, s.status]))
    for (const it of items) (it as Record<string, unknown>).userStatus = statusM.get((it as { userId: string }).userId) || null

    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
