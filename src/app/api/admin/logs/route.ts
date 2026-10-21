// /api/admin/logs — application log viewer (OPS_ROLES)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const where: Record<string, unknown> = {}
  const level = sp.get("level")?.trim()
  const source = sp.get("source")?.trim()
  const q = sp.get("q")?.trim()
  if (level) where.level = level
  if (source) where.source = source
  if (q) where.message = { contains: q }
  const [rows, total] = await Promise.all([
    db.appLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.appLog.count({ where }),
  ])
  return ok({ items: rows, total, page, limit }, requestId)
}
