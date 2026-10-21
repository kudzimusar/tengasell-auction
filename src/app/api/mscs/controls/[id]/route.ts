// GET /api/mscs/controls/[id] — full control + evidence + findings (read: any staff)
// PATCH /api/mscs/controls/[id] — status/applicability/owner update (write: COMPLIANCE+ADMIN)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { STATUSES, APPLICABILITIES, statusNum } from "../../_lib"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)
  const { id } = await params

  const control = await db.mscsControl.findUnique({ where: { id } })
  if (!control) return fail("Control not found", 404, requestId)

  const refs = json<string[]>(control.evidenceRefs, [])
  const [evidence, findings] = await Promise.all([
    db.mscsEvidence.findMany({
      where: { OR: [{ controlId: id }, ...(refs.length ? [{ id: { in: refs } }] : [])] },
      orderBy: { capturedAt: "desc" },
    }),
    db.mscsFinding.findMany({ where: { controlId: id }, orderBy: { createdAt: "desc" } }),
  ])

  return ok({
    control: {
      ...control,
      evidenceRefs: refs,
      evidenceFloor: json<string[]>(control.evidenceFloor, []),
    },
    evidence,
    findings,
  }, requestId)
}

const patchSchema = z.object({
  status: z.enum(STATUSES).optional(),
  statusNote: z.string().max(2000).optional(),
  applicability: z.enum(APPLICABILITIES).optional(),
  applicabilityNote: z.string().max(2000).optional(),
  ownerRole: z.string().max(120).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser(["COMPLIANCE", "ADMIN"])
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Compliance or admin role required", 403, requestId)
  const { id } = await params

  const existing = await db.mscsControl.findUnique({ where: { id } })
  if (!existing) return fail("Control not found", 404, requestId)

  const { data, error: bodyError } = await parseBody(req, patchSchema)
  if (bodyError) return bodyError

  // MSCS doctrine: raising to S50 or above requires an explicit evidence summary in this request
  const raising = data.status ? statusNum(data.status) >= 50 && statusNum(data.status) > statusNum(existing.status) : false
  if (raising && !(data.statusNote || "").trim()) {
    return fail("Raising a control to S50 or above requires a statusNote evidence summary", 422, requestId)
  }

  const updated = await db.mscsControl.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.statusNote !== undefined ? { statusNote: data.statusNote } : {}),
      ...(data.applicability ? { applicability: data.applicability } : {}),
      ...(data.applicabilityNote !== undefined ? { applicabilityNote: data.applicabilityNote } : {}),
      ...(data.ownerRole !== undefined ? { ownerRole: data.ownerRole } : {}),
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "mscs.control.update",
    targetType: "MscsControl",
    targetId: id,
    before: { status: existing.status, statusNote: existing.statusNote, applicability: existing.applicability, applicabilityNote: existing.applicabilityNote, ownerRole: existing.ownerRole },
    after: { status: updated.status, statusNote: updated.statusNote, applicability: updated.applicability, applicabilityNote: updated.applicabilityNote, ownerRole: updated.ownerRole },
    requestId,
    ip,
  })

  return ok({
    control: { ...updated, evidenceRefs: json<string[]>(updated.evidenceRefs, []), evidenceFloor: json<string[]>(updated.evidenceFloor, []) },
  }, requestId)
}
