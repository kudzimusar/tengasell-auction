// GET /api/admin/overview — KPIs + 14-day MetricDaily series (all staff)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"
import { guard, STAFF_PLUS, round2 } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res

  const d30 = new Date(Date.now() - 30 * 24 * 3600_000)

  try {
    const [usersTotal, usersActive, listings, orders, gmvAgg, revCredits, revDebits, openDisputes, openTickets, openReports, pendingApprovals, lastBackup, lastRecon, activeIncidents, staff, seriesRows] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { status: "ACTIVE" } }),
      db.listing.groupBy({ by: ["status"], _count: { _all: true } }),
      db.order.groupBy({ by: ["status"], _count: { _all: true } }),
      db.order.aggregate({
        where: { createdAt: { gte: d30 }, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] } },
        _sum: { totalCharged: true },
      }),
      db.ledgerEntry.aggregate({ where: { account: "PLATFORM_REVENUE", direction: "CREDIT" }, _sum: { amount: true } }),
      db.ledgerEntry.aggregate({ where: { account: "PLATFORM_REVENUE", direction: "DEBIT" }, _sum: { amount: true } }),
      db.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
      db.ticket.count({ where: { status: { not: "CLOSED" } } }),
      db.abuseReport.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
      db.approvalRequest.count({ where: { status: "PENDING" } }),
      db.backupRun.findFirst({ orderBy: { createdAt: "desc" } }),
      db.reconciliationRun.findFirst({ orderBy: { ranAt: "desc" } }),
      db.incident.count({ where: { status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } } }),
      db.user.findMany({
        where: { role: { in: ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"] }, status: "ACTIVE" },
        select: { id: true, name: true, role: true }, orderBy: { role: "asc" },
      }),
      db.metricDaily.findMany({ orderBy: { date: "desc" }, take: 14 }),
    ])

    const revenue = round2((revCredits._sum.amount || 0) - (revDebits._sum.amount || 0))

    const listingsByStatus: Record<string, number> = {}
    for (const g of listings) listingsByStatus[g.status] = g._count._all
    const ordersByStatus: Record<string, number> = {}
    for (const g of orders) ordersByStatus[g.status] = g._count._all

    const series = seriesRows.slice().reverse().map((m) => ({
      date: m.date.slice(5),
      gmv: round2(m.gmv), orders: m.orders, users: m.users, newUsers: m.newUsers,
      disputes: m.disputes, tickets: m.tickets, availabilityPct: m.availabilityPct,
    }))

    return ok({
      users: { total: usersTotal, active: usersActive },
      listingsByStatus, ordersByStatus,
      gmv30d: round2(gmvAgg._sum.totalCharged || 0),
      revenue,
      openDisputes, openTickets, openReports, pendingApprovals, activeIncidents,
      lastBackup: lastBackup ? { createdAt: lastBackup.createdAt, status: lastBackup.status, kind: lastBackup.kind } : null,
      lastReconciliation: lastRecon ? { status: lastRecon.status, ranAt: lastRecon.ranAt } : null,
      series,
      staff,
    }, requestId)
  } catch {
    return ok({
      users: { total: 0, active: 0 }, listingsByStatus: {}, ordersByStatus: {},
      gmv30d: 0, revenue: 0, openDisputes: 0, openTickets: 0, openReports: 0,
      pendingApprovals: 0, activeIncidents: 0, lastBackup: null, lastReconciliation: null,
      series: [], staff: [],
    }, requestId)
  }
}
