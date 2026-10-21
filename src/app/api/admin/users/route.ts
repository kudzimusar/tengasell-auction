// GET /api/admin/users — list with seller status, risk, lastLogin (SUPPORT+)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, STAFF_PLUS } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const q = (sp.get("q") || "").trim().slice(0, 120)
  const role = sp.get("role") || undefined
  const status = sp.get("status") || undefined

  const where: Record<string, unknown> = {}
  if (role && role !== "ALL") where.role = role
  if (status && status !== "ALL") where.status = status
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
      { handle: { contains: q } },
    ]
  }

  try {
    const [rows, total] = await Promise.all([
      db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.user.count({ where }),
    ])
    const sellerIds = rows.filter((r) => r.isSeller).map((r) => r.id)
    const profiles = sellerIds.length ? await db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : []
    const profMap = new Map(profiles.map((p) => [p.userId, p]))

    const items = rows.map((u) => {
      const p = profMap.get(u.id)
      return {
        id: u.id, name: u.name, email: u.email, handle: u.handle, role: u.role,
        status: u.status, riskScore: u.riskScore, isSeller: u.isSeller,
        avatarEmoji: u.avatarEmoji, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
        seller: p ? { id: p.id, status: p.status, shopName: p.shopName } : null,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
