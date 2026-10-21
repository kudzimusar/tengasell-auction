// /api/admin/ops/webhooks — endpoints + deliveries + DLQ count (API-017..019 surface)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const [endpoints, deliveries, dlq] = await Promise.all([
    db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.webhookDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.webhookDelivery.count({ where: { status: "DEAD" } }),
  ])
  const items = endpoints.map(e => ({ ...e, events: JSON.parse(e.events || "[]") }))
  return ok({ endpoints: items, deliveries, dlq }, requestId)
}
