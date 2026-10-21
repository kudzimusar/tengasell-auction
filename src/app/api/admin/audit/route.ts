// /api/admin/audit — append-only audit trail viewer (CTL-018; ADMIN+COMPLIANCE)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate } from "@/lib/server/api"
import { guard, AUDIT_ROLES, userMap } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(AUDIT_ROLES, requestId)
  if (!user) return res
  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const where: Record<string, unknown> = {}
  const actor = sp.get("actor")?.trim()
  const action = sp.get("action")?.trim()
  const targetType = sp.get("targetType")?.trim()
  if (action) where.action = { contains: action }
  if (targetType) where.targetType = targetType
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.auditLog.count({ where }),
  ])
  const names = await userMap(rows.map(r => r.actorId).filter(Boolean) as string[])
  const items = rows.map(r => ({ ...r, actorName: r.actorId ? names.get(r.actorId) || null : null }))
  return ok({ items, total, page, limit }, requestId)
}
