// GET /api/admin/orders — filterable list with buyer/seller/listing joins (SUPPORT+FINANCE; inspect only)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, ORDER_ROLES } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(ORDER_ROLES, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined
  const q = (sp.get("q") || "").trim().slice(0, 120)

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  if (q) where.id = { contains: q }

  try {
    const [rows, total] = await Promise.all([
      db.order.findMany({ where, orderBy: { placedAt: "desc" }, skip, take: limit }),
      db.order.count({ where }),
    ])

    const userIds = [...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))]
    const listingIds = [...new Set(rows.map((r) => r.listingId))]
    const [users, profiles, listings] = await Promise.all([
      userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
      userIds.length ? db.sellerProfile.findMany({ where: { userId: { in: userIds } } }) : [],
      listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds } } }) : [],
    ])
    const userM = new Map(users.map((u) => [u.id, u]))
    const profM = new Map(profiles.map((p) => [p.userId, p]))
    const listingM = new Map(listings.map((l) => [l.id, l]))

    const items = rows.map((o) => {
      const buyer = userM.get(o.buyerId)
      const prof = profM.get(o.sellerId)
      const l = listingM.get(o.listingId)
      return {
        id: o.id, status: o.status, type: o.type, amount: o.amount, totalCharged: o.totalCharged,
        placedAt: o.placedAt, paidAt: o.paidAt,
        listingTitle: l?.title || "—",
        buyerName: buyer?.name || "—", buyerEmail: buyer?.email || "",
        sellerShop: prof?.shopName || userM.get(o.sellerId)?.name || "—",
        sellerId: o.sellerId, buyerId: o.buyerId, listingId: o.listingId,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
