// /api/admin/ops/break-glass/[id] — second-admin APPROVE or REVOKE (dual control on emergency access)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, ADMIN_ONLY } from "../../../_lib/ctl"

export const runtime = "nodejs"

const schema = z.object({ action: z.enum(["APPROVE", "REVOKE"]), note: z.string().max(300).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(ADMIN_ONLY, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const bg = await db.breakGlassAccess.findUnique({ where: { id } })
  if (!bg) return fail("Request not found", 404, requestId)
  if (data.action === "APPROVE") {
    if (bg.grantedAt) return fail("Already granted", 409, requestId)
    if (bg.requestedBy === user.email) return fail("Dual control: a different admin must approve", 422, requestId)
    const after = await db.breakGlassAccess.update({ where: { id }, data: { grantedAt: new Date() } })
    await audit({
      actorId: user.id, actorRole: user.role, action: "ops.breakglass.approve", targetType: "BREAK_GLASS", targetId: id,
      before: { granted: false }, after: { granted: true, expiresAt: bg.expiresAt }, reason: data.note, requestId, ip,
    })
    return ok(after, requestId)
  }
  const after = await db.breakGlassAccess.update({ where: { id }, data: { revokedAt: new Date() } })
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.breakglass.revoke", targetType: "BREAK_GLASS", targetId: id,
    after: { revoked: true }, reason: data.note || "revoked", requestId, ip,
  })
  return ok(after, requestId)
}
