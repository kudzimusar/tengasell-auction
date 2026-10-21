// /api/admin/ops/incidents — declare + list (INC-001..007); PATCH via [id]
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, OPS_ROLES, nextIncidentRef } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const status = req.nextUrl.searchParams.get("status")?.trim()
  const where = status && status !== "ALL" ? { status } : {}
  const items = await db.incident.findMany({ where, orderBy: { startedAt: "desc" }, take: 50 })
  return ok({ items }, requestId)
}

const schema = z.object({
  title: z.string().trim().min(5).max(160),
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]),
  impact: z.string().trim().max(500).optional(),
  summary: z.string().trim().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const ref = await nextIncidentRef()
  const inc = await db.incident.create({
    data: {
      ref, severity: data.severity, title: data.title, impact: data.impact, summary: data.summary,
      status: "OPEN", commander: user.name,
      regulatoryNotification: data.severity === "SEV1" || data.severity === "SEV2",
    },
  })
  await db.statusEvent.create({
    data: { component: "core", status: data.severity === "SEV1" ? "DOWN" : "DEGRADED", message: data.title, startedAt: new Date() },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.incident.declare", targetType: "INCIDENT", targetId: inc.id,
    after: { ref, severity: data.severity, title: data.title }, requestId, ip,
  })
  return ok(inc, requestId, 201)
}
