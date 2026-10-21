// GET /api/admin/reports — abuse queue with target labels (MODERATOR+)
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
      db.abuseReport.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.abuseReport.count({ where }),
    ])

    const users = await userMap(rows.map((r) => r.reporterId || "").concat(rows.map((r) => r.handledBy || "")))

    // Resolve target labels
    const listingIds = rows.filter((r) => r.targetType === "LISTING").map((r) => r.targetId)
    const listings = listingIds.length ? await db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true } }) : []
    const listingM = new Map(listings.map((l) => [l.id, l.title]))

    const items = rows.map((r) => {
      let targetLabel: string | null = null
      if (r.targetType === "LISTING") targetLabel = listingM.get(r.targetId) || null
      else if (r.targetType === "USER") targetLabel = users.get(r.targetId)?.name || null
      return {
        ...r,
        reporterName: r.reporterId ? users.get(r.reporterId)?.name || null : null,
        handledByName: r.handledBy ? users.get(r.handledBy)?.name || null : null,
        targetLabel,
      }
    })
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
