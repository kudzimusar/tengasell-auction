// GET /api/mscs/controls — paginated registry worksheet rows (read: any staff)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json, paginate } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)

  const sp = req.nextUrl.searchParams
  const domain = sp.get("domain") || undefined
  const applicability = sp.get("applicability") || undefined
  const status = sp.get("status") || undefined
  const criticality = sp.get("criticality") || undefined
  const search = (sp.get("search") || "").trim()
  const { limit, page, skip } = paginate(sp, 100)

  const where: Record<string, unknown> = {}
  if (domain) where.domain = domain
  if (applicability) where.applicability = applicability
  if (status) where.status = status
  if (criticality) where.criticality = criticality
  if (search) {
    where.OR = [{ id: { contains: search } }, { name: { contains: search } }]
  }

  const [rows, total] = await Promise.all([
    db.mscsControl.findMany({ where, orderBy: [{ domain: "asc" }, { id: "asc" }], skip, take: limit }),
    db.mscsControl.count({ where }),
  ])

  // Open findings count per control on this page (one grouped query, no N+1)
  const ids = rows.map((r) => r.id)
  const openFindings = ids.length
    ? await db.mscsFinding.groupBy({ by: ["controlId"], where: { controlId: { in: ids }, status: "OPEN" }, _count: { _all: true } })
    : []
  const findingMap = new Map(openFindings.map((f) => [f.controlId, f._count._all]))

  const items = rows.map((r) => ({
    ...r,
    evidenceRefs: json<string[]>(r.evidenceRefs, []),
    evidenceCount: json<string[]>(r.evidenceRefs, []).length,
    evidenceFloor: json<string[]>(r.evidenceFloor, []),
    openFindings: findingMap.get(r.id) || 0,
  }))

  return ok({ items, total, page, limit }, requestId)
}
