// GET /api/admin/disputes — mediation queue (SUPPORT+MODERATOR)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, DISPUTE_ROLES, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(DISPUTE_ROLES, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status

  try {
    const [rows, total] = await Promise.all([
      db.dispute.findMany({ where, orderBy: { openedAt: "desc" }, skip, take: limit }),
      db.dispute.count({ where }),
    ])
    if (rows.length === 0) return ok({ items: [], total: 0, page, limit }, requestId)

    const orders = await db.order.findMany({ where: { id: { in: rows.map((r) => r.orderId) } } })
    const orderM = new Map(orders.map((o) => [o.id, o]))
    const listingIds = [...new Set(orders.map((o) => o.listingId))]
    const listings = listingIds.length ? await db.listing.findMany({ where: { id: { in: listingIds } } }) : []
    const listingM = new Map(listings.map((l) => [l.id, l]))

    const users = await userMap(rows.flatMap((r) => [r.openedBy, r.assignedTo || ""]))

    const items = rows.map((d) => {
      const order = orderM.get(d.orderId)
      const listing = order ? listingM.get(order.listingId) : null
      return {
        id: d.id, orderId: d.orderId, reason: d.reason, details: d.details, status: d.status,
        resolution: d.resolution, openedAt: d.openedAt, resolvedAt: d.resolvedAt,
        openedBy: d.openedBy, openedByName: users.get(d.openedBy)?.name || null,
        assignedTo: d.assignedTo, assignedToName: d.assignedTo ? users.get(d.assignedTo)?.name || null : null,
        orderAmount: order ? order.totalCharged : null, orderStatus: order?.status || null,
        listingTitle: listing?.title || null,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
