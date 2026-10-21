// POST /api/mscs/findings/[id]/action — ACCEPT|CLOSE|WAIVE a finding (write: COMPLIANCE+ADMIN)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const actionSchema = z.object({
  action: z.enum(["ACCEPT", "CLOSE", "WAIVE"]),
  note: z.string().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser(["COMPLIANCE", "ADMIN"])
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Compliance or admin role required", 403, requestId)
  const { id } = await params

  const existing = await db.mscsFinding.findUnique({ where: { id } })
  if (!existing) return fail("Finding not found", 404, requestId)
  if (existing.status !== "OPEN") return fail(`Finding already ${existing.status}`, 409, requestId)

  const { data, error: bodyError } = await parseBody(req, actionSchema)
  if (bodyError) return bodyError

  const updated = await db.mscsFinding.update({
    where: { id },
    data: {
      status: data.action,
      resolvedAt: new Date(),
      ...(data.note ? { note: `${existing.note}\n[${data.action}] ${data.note}` } : {}),
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: `mscs.finding.${data.action.toLowerCase()}`,
    targetType: "MscsFinding",
    targetId: id,
    before: { status: existing.status },
    after: { status: updated.status, note: data.note },
    requestId,
    ip,
  })

  return ok({ finding: updated }, requestId)
}
