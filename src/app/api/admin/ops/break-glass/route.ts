// /api/admin/ops/break-glass — emergency access requests + decisions (CTL-022/BCP-011)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, ADMIN_ONLY, OPS_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const items = await db.breakGlassAccess.findMany({ orderBy: { createdAt: "desc" }, take: 30 })
  return ok({ items }, requestId)
}

const schema = z.object({ reason: z.string().trim().min(5).max(500) })

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(ADMIN_ONLY, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const bg = await db.breakGlassAccess.create({
    data: { requestedBy: user.email, reason: data.reason, expiresAt: new Date(Date.now() + 60 * 60000) },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.breakglass.request", targetType: "BREAK_GLASS", targetId: bg.id,
    after: { reason: data.reason, expiresAt: bg.expiresAt }, requestId, ip,
  })
  return ok(bg, requestId, 201)
}
