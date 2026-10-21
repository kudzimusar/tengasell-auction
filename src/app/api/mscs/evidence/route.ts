// GET /api/mscs/evidence?controlId — evidence list for a control (read: any staff)
// POST /api/mscs/evidence — capture evidence + attach to control (write: COMPLIANCE+ADMIN)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { EVIDENCE_CLASSES, nextEvidenceId } from "../_lib"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)

  const controlId = req.nextUrl.searchParams.get("controlId") || undefined
  if (!controlId) return fail("controlId query parameter required", 400, requestId)

  const control = await db.mscsControl.findUnique({ where: { id: controlId } })
  if (!control) return fail("Control not found", 404, requestId)
  const refs = json<string[]>(control.evidenceRefs, [])

  const evidence = await db.mscsEvidence.findMany({
    where: { OR: [{ controlId }, ...(refs.length ? [{ id: { in: refs } }] : [])] },
    orderBy: { capturedAt: "desc" },
  })
  return ok({ items: evidence }, requestId)
}

const createSchema = z.object({
  controlId: z.string().min(3),
  evidenceClass: z.enum(EVIDENCE_CLASSES),
  description: z.string().min(3).max(500),
  source: z.string().min(2).max(300),
  authority: z.string().max(200).optional(),
  observed: z.string().min(2).max(1000),
  expected: z.string().min(2).max(1000),
  validUntil: z.string().datetime().optional(),
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

  const evId = await nextEvidenceId()
  const ev = await db.mscsEvidence.create({
    data: {
      id: evId,
      controlId: control.id,
      evidenceClass: data.evidenceClass,
      description: data.description,
      source: data.source,
      authority: data.authority ?? null,
      observed: data.observed,
      expected: data.expected,
      capturedBy: user.role,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    },
  })

  // Append the evidence id to the control's evidenceRefs
  const refs = json<string[]>(control.evidenceRefs, [])
  if (!refs.includes(evId)) {
    refs.push(evId)
    await db.mscsControl.update({ where: { id: control.id }, data: { evidenceRefs: JSON.stringify(refs) } })
  }

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "mscs.evidence.create",
    targetType: "MscsEvidence",
    targetId: evId,
    after: { controlId: control.id, evidenceClass: data.evidenceClass, description: data.description },
    requestId,
    ip,
  })

  return ok({ evidence: ev, controlEvidenceRefs: refs }, requestId, 201)
}
