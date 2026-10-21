// GET /api/admin/approvals — dual-control queue (all staff)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate, json } from "@/lib/server/api"
import { guard, STAFF_PLUS, userMap, payloadPreview } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined
  const type = sp.get("type") || undefined

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status
  if (type) where.type = type

  try {
    const [rows, total] = await Promise.all([
      db.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.approvalRequest.count({ where }),
    ])
    const users = await userMap(rows.flatMap((r) => [r.requestedBy, r.decidedBy || ""]))

    const items = rows.map((a) => ({
      id: a.id, type: a.type, status: a.status, createdAt: a.createdAt,
      requestedBy: a.requestedBy, requestedByName: users.get(a.requestedBy)?.name || null,
      requesterRole: users.get(a.requestedBy)?.role || null,
      decidedBy: a.decidedBy, decidedByName: a.decidedBy ? users.get(a.decidedBy)?.name || null : null,
      decidedAt: a.decidedAt, reason: a.reason,
      payload: json(a.payload, {} as Record<string, unknown>),
      payloadPreview: payloadPreview(a.payload),
    }))
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}
