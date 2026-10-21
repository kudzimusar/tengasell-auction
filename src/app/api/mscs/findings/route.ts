// GET /api/mscs/findings?status&controlId — findings register (read: any staff)
// POST /api/mscs/findings — raise a finding against a control (write: COMPLIANCE+ADMIN)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { FINDING_CODES } from "../_lib"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)

  const sp = req.nextUrl.searchParams
  const status = sp.get("status") || undefined
  const controlId = sp.get("controlId") || undefined
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (controlId) where.controlId = controlId

  const items = await db.mscsFinding.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  })
  return ok({ items, total: items.length }, requestId)
}

const createSchema = z.object({
  controlId: z.string().min(3),
  code: z.enum(FINDING_CODES),
  note: z.string().min(3).max(1000),
  owner: z.string().max(120).optional(),
  dueAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser(["COMPLIANCE", "ADMIN"])
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Compliance or admin role required", 403, requestId)

  const { data, error: bodyError } = await parseBody(req, createSchema)
  if (bodyError) return bodyError

  const control = await db.mscsControl.findUnique({ where: { id: data.controlId } })
  if (!control) return fail("Control not found", 404, requestId)

  const finding = await db.mscsFinding.create({
    data: {
      controlId: control.id,
      code: data.code,
      note: data.note,
      owner: data.owner ?? user.role,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "mscs.finding.create",
    targetType: "MscsFinding",
    targetId: finding.id,
    after: { controlId: control.id, code: data.code, note: data.note },
    requestId,
    ip,
  })

  return ok({ finding }, requestId, 201)
}
