// GET /api/admin/finance/ledger — entries + direction-aware account balances (FINANCE+ADMIN)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, FINANCE_ROLES, accountBalances } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const account = sp.get("account") || undefined
  const orderRef = (sp.get("orderRef") || "").trim().slice(0, 60)

  const where: Record<string, unknown> = {}
  if (account && account !== "ALL") where.account = account
  if (orderRef) where.orderRef = { contains: orderRef }

  try {
    const [rows, total, balances] = await Promise.all([
      db.ledgerEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.ledgerEntry.count({ where }),
      accountBalances(),
    ])
    return ok({ items: rows, total, page, limit, balances }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit, balances: {} }, requestId)
  }
}
