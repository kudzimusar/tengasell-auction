// GET /api/admin/sellers — verification states + health (SUPPORT+)
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
  const status = sp.get("status") || undefined
  const q = (sp.get("q") || "").trim().slice(0, 120)

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  if (q) {
    where.OR = [{ shopName: { contains: q } }, { slug: { contains: q } }]
  }

  try {
    const [rows, total] = await Promise.all([
      db.sellerProfile.findMany({ orderBy: { joinedAt: "desc" }, skip, take: limit, where }),
      db.sellerProfile.count({ where }),
    ])
    const owners = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, name: true, email: true, status: true },
    })
    const ownerMap = new Map(owners.map((o) => [o.id, o]))

    const items = rows.map((p) => ({
      id: p.id, userId: p.userId, shopName: p.shopName, slug: p.slug, status: p.status,
      identityVerified: p.identityVerified, businessVerified: p.businessVerified,
      taxVerified: p.taxVerified, payoutVerified: p.payoutVerified,
      healthScore: p.healthScore, ratingAvg: p.ratingAvg, ratingCount: p.ratingCount,
      documents: JSON.parse(p.documents || "[]"), verificationNotes: p.verificationNotes,
      joinedAt: p.joinedAt,
      user: ownerMap.get(p.userId) || null,
    }))
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
