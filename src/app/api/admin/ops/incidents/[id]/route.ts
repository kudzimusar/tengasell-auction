// /api/admin/ops/incidents/[id] — MITIGATE | RESOLVE | CLOSE transitions + postmortem ref (INC-010/011)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../../_lib/ctl"

export const runtime = "nodejs"

const schema = z.object({
  action: z.enum(["MITIGATE", "RESOLVE", "CLOSE"]),
  commander: z.string().trim().max(120).optional(),
  postmortemRef: z.string().trim().max(60).optional(),
  note: z.string().max(500).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const inc = await db.incident.findUnique({ where: { id } })
  if (!inc) return fail("Incident not found", 404, requestId)
  if (data.action === "RESOLVE" && !data.postmortemRef) return fail("postmortemRef required to resolve (INC-011)", 422, requestId)
  const now = new Date()
  const update: Record<string, unknown> = {
    status: data.action === "MITIGATE" ? "MITIGATED" : data.action === "RESOLVE" ? "RESOLVED" : "CLOSED",
    commander: data.commander || inc.commander,
  }
  if (data.action === "MITIGATE") update.mitigatedAt = now
  if (data.action === "RESOLVE") { update.resolvedAt = now; update.postmortemRef = data.postmortemRef }
  if (data.action === "CLOSE") update.resolvedAt = inc.resolvedAt || now
  const after = await db.incident.update({ where: { id }, data: update })
  if (data.action !== "MITIGATE") {
    await db.statusEvent.updateMany({ where: { component: "core", endedAt: null }, data: { endedAt: now } }).catch(() => undefined)
    await db.statusEvent.create({ data: { component: "core", status: "OPERATIONAL", message: `Incident ${inc.ref} resolved`, startedAt: now, endedAt: now } })
  }
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.incident." + data.action.toLowerCase(), targetType: "INCIDENT", targetId: id,
    before: { status: inc.status }, after: { status: after.status, postmortemRef: after.postmortemRef }, reason: data.note, requestId, ip,
  })
  return ok(after, requestId)
}
