// /api/admin/ops/webhooks/[id]/action — RETRY | SUSPEND | ACTIVATE (INT-007/008)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../../../_lib/ctl"

export const runtime = "nodejs"

const schema = z.object({ action: z.enum(["RETRY", "SUSPEND", "ACTIVATE"]) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const ep = await db.webhookEndpoint.findUnique({ where: { id } })
  if (!ep) return fail("Endpoint not found", 404, requestId)
  const after =
    data.action === "RETRY"
      ? await db.webhookDelivery.updateMany({ where: { endpointId: id, status: { in: ["PENDING", "FAILED"] } }, data: { nextRetryAt: new Date(), status: "PENDING" } })
      : await db.webhookEndpoint.update({ where: { id }, data: { status: data.action === "SUSPEND" ? "SUSPENDED" : "ACTIVE" } })
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.webhook." + data.action.toLowerCase(), targetType: "WEBHOOK", targetId: id,
    before: { status: ep.status }, after: data.action === "RETRY" ? { requeued: after.count } : { status: (after as { status: string }).status }, requestId, ip,
  })
  return ok({ done: true }, requestId)
}
