// /api/admin/privacy/dsar — DSAR queue for compliance staff (PRV-005..010)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, PRIVACY_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(PRIVACY_ROLES, requestId)
  if (!user) return res
  const { limit, page, skip } = paginate(req.nextUrl.searchParams)
  const status = req.nextUrl.searchParams.get("status")?.trim()
  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  const [rows, total] = await Promise.all([
    db.dsarRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.dsarRequest.count({ where }),
  ])
  return ok({ items: rows, total, page, limit }, requestId)
}
