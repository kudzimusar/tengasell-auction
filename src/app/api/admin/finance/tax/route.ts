// /api/admin/finance/tax — VAT lines + remittance toggle (FIN-012/GOV-003)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, FINANCE_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const lines = await db.taxLine.findMany({ orderBy: { orderId: "desc" }, take: 200 })
  const total = lines.filter(l => !l.remitted).reduce((s, l) => s + l.amount, 0)
  return ok({ items: lines, outstandingVat: Math.round(total * 100) / 100 }, requestId)
}

const schema = z.object({ taxLineIds: z.array(z.string()).min(1).max(500) })

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const updated = await db.taxLine.updateMany({ where: { id: { in: data.taxLineIds }, remitted: false }, data: { remitted: true } })
  await audit({
    actorId: user.id, actorRole: user.role, action: "finance.tax.remit", targetType: "TAXLINE",
    after: { count: updated.count }, reason: "VAT remittance marked", requestId, ip,
  })
  return ok({ updated: updated.count }, requestId)
}
