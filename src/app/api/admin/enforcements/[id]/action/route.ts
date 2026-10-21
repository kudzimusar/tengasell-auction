// POST /api/admin/enforcements/[id]/action — LIFT (MODERATOR+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, MOD_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.literal("LIFT"),
  note: z.string().trim().min(3).max(1000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const enf = await db.enforcement.findUnique({ where: { id } })
    if (!enf) return fail("Enforcement not found", 404, requestId)
    if (enf.liftedAt) return fail("Enforcement already lifted", 422, requestId)

    const now = new Date()
    const before = { liftedAt: enf.liftedAt, liftedBy: enf.liftedBy }
    const updated = await db.enforcement.update({
      where: { id },
      data: { liftedAt: now, liftedBy: user.id, notes: `${enf.notes || ""}\n[lifted] ${data.note}`.trim() },
    })

    // Restore the account if the enforcement had suspended/banned it and nothing else still applies
    if (enf.level === "SUSPENSION" || enf.level === "BAN") {
      const target = await db.user.findUnique({ where: { id: enf.userId } })
      const stillActive = await db.enforcement.count({
        where: { userId: enf.userId, liftedAt: null, level: { in: ["SUSPENSION", "BAN"] }, id: { not: enf.id } },
      })
      if (target && (target.status === "SUSPENDED" || target.status === "BANNED") && stillActive === 0) {
        await db.user.update({ where: { id: target.id }, data: { status: "ACTIVE", statusReason: null } })
      }
    }

    await notify(enf.userId, "ENFORCEMENT_LIFTED", { level: enf.level, note: data.note })
    await audit({
      actorId: user.id, actorRole: user.role, action: "enforcement.lift", targetType: "ENFORCEMENT", targetId: enf.id,
      before, after: { liftedAt: updated.liftedAt, liftedBy: updated.liftedBy }, reason: data.note, requestId, ip,
    })
    return ok({ liftedAt: updated.liftedAt }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
