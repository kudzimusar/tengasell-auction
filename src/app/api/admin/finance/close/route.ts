// /api/admin/finance/close — monthly close (FIN-018): compute totals, close period
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, FINANCE_ROLES, round2 } from "../../_lib/ctl"

export const runtime = "nodejs"

async function totalsFor(period: string) {
  const start = new Date(`${period}-01T00:00:00Z`)
  const end = new Date(start.getTime()); end.setMonth(end.getMonth() + 1)
  const where = { createdAt: { gte: start, lt: end } }
  const paidWhere = { paidAt: { gte: start, lt: end } }
  const [orders, refunds, payouts, revenue, vat] = await Promise.all([
    db.order.findMany({ where: paidWhere }),
    db.refund.aggregate({ where: { createdAt: { gte: start, lt: end }, status: "PROCESSED" }, _sum: { amount: true } }),
    db.payout.aggregate({ where: { processedAt: { gte: start, lt: end }, status: "PAID" }, _sum: { amount: true } }),
    db.ledgerEntry.aggregate({ where: { ...where, account: "PLATFORM_REVENUE", direction: "CREDIT" }, _sum: { amount: true } }),
    db.ledgerEntry.aggregate({ where: { ...where, account: "VAT_PAYABLE", direction: "CREDIT" }, _sum: { amount: true } }),
  ])
  const gmv = orders.reduce((s, o) => s + (o.totalCharged || 0), 0)
  return {
    period, orders: orders.length, gmv: round2(gmv),
    refunds: round2(refunds._sum.amount || 0), payouts: round2(payouts._sum.amount || 0),
    revenue: round2(revenue._sum.amount || 0), vatCollected: round2(vat._sum.amount || 0),
  }
}

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const current = new Date().toISOString().slice(0, 7)
  const rows = await db.monthlyClose.findMany({ orderBy: { period: "desc" }, take: 12 })
  const open = rows.find(r => r.period === current && r.status === "OPEN")
  const projected = await totalsFor(current)
  return ok({ current, closes: rows, projected }, requestId)
}

const schema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) })

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const existing = await db.monthlyClose.findUnique({ where: { period: data.period } })
  if (existing?.status === "CLOSED") return fail("Period already closed", 409, requestId)
  const totals = await totalsFor(data.period)
  const closed = existing
    ? await db.monthlyClose.update({ where: { period: data.period }, data: { status: "CLOSED", closedBy: user.email, closedAt: new Date(), totals: JSON.stringify(totals) } })
    : await db.monthlyClose.create({ data: { period: data.period, status: "CLOSED", closedBy: user.email, closedAt: new Date(), totals: JSON.stringify(totals) } })
  await audit({
    actorId: user.id, actorRole: user.role, action: "finance.close", targetType: "MONTHLY_CLOSE", targetId: data.period,
    before: { status: existing?.status || "OPEN" }, after: { status: "CLOSED", totals }, requestId, ip,
  })
  return ok(closed, requestId, 201)
}
