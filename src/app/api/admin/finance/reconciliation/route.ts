// /api/admin/finance/reconciliation — COM-024/FIN-009: payment-vs-ledger vs orders reconciliation runs
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, audit } from "@/lib/server/api"
import { guard, FINANCE_ROLES, round2 } from "../../_lib/ctl"

export const runtime = "nodejs"

async function compute() {
  const [payments, ledger, orders] = await Promise.all([
    db.payment.aggregate({ where: { status: "CAPTURED" }, _sum: { amount: true } }),
    db.ledgerEntry.aggregate({ where: { account: "BUYER_PAYMENTS", direction: "DEBIT" }, _sum: { amount: true } }),
    db.order.aggregate({ where: { status: { in: ["PAID", "SHIPPED", "DELIVERED", "COMPLETED", "DISPUTED"] } }, _sum: { totalCharged: true } }),
  ])
  const expected = round2(payments._sum.amount || 0)
  const actual = round2(ledger._sum.amount || 0)
  const ordersSum = round2(orders._sum.totalCharged || 0)
  const variance = round2(expected - actual)
  return {
    expected, actual, ordersSum, variance,
    status: Math.abs(variance) < 0.01 ? "BALANCED" : "VARIANCE",
  }
}

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const runs = await db.reconciliationRun.findMany({ orderBy: { ranAt: "desc" }, take: 20 })
  return ok({ items: runs, live: await compute() }, requestId)
}

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const live = await compute()
  const run = await db.reconciliationRun.create({
    data: {
      periodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      periodEnd: new Date(),
      expected: JSON.stringify({ capturedPayments: live.expected, ordersCharged: live.ordersSum }),
      actual: JSON.stringify({ ledgerBuyerPayments: live.actual }),
      variance: JSON.stringify({ variance: live.variance }),
      status: live.status, runBy: user.email,
    },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "finance.reconciliation.run", targetType: "RECONCILIATION", targetId: run.id,
    before: null, after: live, reason: "monthly reconciliation", requestId, ip,
  })
  return ok(run, requestId, 201)
}
