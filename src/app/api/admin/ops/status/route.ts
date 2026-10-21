// /api/admin/ops/status — current components + history; POST posts a status event (OPS-018)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

const COMPONENTS = ["core", "payments", "search", "comms"]

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const events = await db.statusEvent.findMany({ orderBy: { startedAt: "desc" }, take: 30 })
  const current: Record<string, unknown> = {}
  for (const c of COMPONENTS) {
    const ev = events.find(e => e.component === c && !e.endedAt)
    current[c] = ev || { component: c, status: "OPERATIONAL", message: null }
  }
  return ok({ current, history: events }, requestId)
}

const schema = z.object({
  component: z.enum(["core", "payments", "search", "comms"]),
  status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "MAINTENANCE"]),
  message: z.string().trim().max(200).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  await db.statusEvent.updateMany({ where: { component: data.component, endedAt: null }, data: { endedAt: new Date() } })
  const ev = await db.statusEvent.create({
    data: { component: data.component, status: data.status, message: data.message, startedAt: new Date(), endedAt: data.status === "OPERATIONAL" ? new Date() : null },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.status.post", targetType: "STATUS_EVENT", targetId: ev.id,
    after: { component: data.component, status: data.status, message: data.message }, requestId, ip,
  })
  return ok(ev, requestId, 201)
}
