// /api/admin/config/flags/[key] — feature flag toggle (ADMIN only; CTL-022 emergency controls)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, ADMIN_ONLY } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({ enabled: z.boolean(), rolloutNote: z.string().trim().max(300).optional() })

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { key } = await params
  const { user, res } = await guard(ADMIN_ONLY, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, bodySchema)
  if (error) return error
  const before = await db.featureFlag.findUnique({ where: { key } })
  if (!before) return fail("Flag not found", 404, requestId)
  const after = await db.featureFlag.update({
    where: { key },
    data: { enabled: data.enabled, rolloutNote: data.rolloutNote ?? before.rolloutNote, updatedBy: user.email },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "config.flag", targetType: "FLAG", targetId: key,
    before: { enabled: before.enabled, rolloutNote: before.rolloutNote },
    after: { enabled: after.enabled, rolloutNote: after.rolloutNote },
    reason: data.rolloutNote || `flag ${key} → ${data.enabled}`, requestId, ip,
  })
  return ok({ key, enabled: after.enabled }, requestId)
}
