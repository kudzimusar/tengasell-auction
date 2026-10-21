// /api/admin/ops/metrics — MetricDaily series for dashboards (BI/OPS-003)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const days = Math.min(Number(req.nextUrl.searchParams.get("days") || 14), 90)
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const items = await db.metricDaily.findMany({ where: { date: { gte: since } }, orderBy: { date: "asc" } })
  return ok({ items }, requestId)
}
