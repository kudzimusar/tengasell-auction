// /api/admin/config/settings/[key] — setting update; requiresApproval keys go to the dual-approval queue
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, ADMIN_ONLY } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({ value: z.unknown(), note: z.string().trim().max(300).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { key } = await params
  const { user, res } = await guard(ADMIN_ONLY, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, bodySchema)
  if (error) return error
  const before = await db.configSetting.findUnique({ where: { key } })
  if (!before) return fail("Setting not found", 404, requestId)
  const newValue = JSON.stringify(data.value ?? null)
  if (before.requiresApproval) {
    const approval = await db.approvalRequest.create({
      data: { type: "CONFIG", payload: JSON.stringify({ key, value: data.value, before: before.value, note: data.note }), requestedBy: user.id, status: "PENDING" },
    })
    await audit({
      actorId: user.id, actorRole: user.role, action: "config.settings.request", targetType: "CONFIG", targetId: key,
      before: { value: before.value }, after: { value: newValue, approvalId: approval.id },
      reason: data.note || "requires dual approval", requestId, ip,
    })
    return ok({ status: "PENDING_APPROVAL", approvalId: approval.id }, requestId, 202)
  }
  const after = await db.configSetting.update({ where: { key }, data: { value: newValue, updatedBy: user.email } })
  await audit({
    actorId: user.id, actorRole: user.role, action: "config.settings.apply", targetType: "CONFIG", targetId: key,
    before: { value: before.value }, after: { value: after.value },
    reason: data.note || `direct apply ${key}`, requestId, ip,
  })
  return ok({ key, value: after.value }, requestId)
}
