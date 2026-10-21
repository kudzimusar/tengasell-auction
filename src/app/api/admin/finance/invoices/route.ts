// /api/admin/finance/invoices — invoice register (COM-020)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, FINANCE_ROLES, userMap } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const { limit, page, skip } = paginate(req.nextUrl.searchParams)
  const [rows, total] = await Promise.all([
    db.invoice.findMany({ orderBy: { issuedAt: "desc" }, skip, take: limit }),
    db.invoice.count(),
  ])
  const names = await userMap(rows.map(r => r.toUserId))
  const items = rows.map(r => ({ ...r, toUserName: names.get(r.toUserId) || null }))
  return ok({ items, total, page, limit }, requestId)
}
