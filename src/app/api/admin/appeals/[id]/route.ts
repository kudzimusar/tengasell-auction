// POST /api/admin/appeals/[id] — UPHOLD | REVERSE (MODERATOR+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, MOD_PLUS, notify } from "../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  decision: z.enum(["UPHOLD", "REVERSE"]),
  note: z.string().trim().min(3).max(2000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const appeal = await db.appeal.findUnique({ where: { id } })
    if (!appeal) return fail("Appeal not found", 404, requestId)
    if (appeal.status === "UPHELD" || appeal.status === "REVERSED") {
      return fail("Appeal already decided", 422, requestId)
    }
    const enf = await db.enforcement.findUnique({ where: { id: appeal.enforcementId } })
    if (!enf) return fail("Linked enforcement no longer exists", 422, requestId)

    const now = new Date()
    const before = { status: appeal.status, enforcementLifted: !!enf.liftedAt, userStatus: undefined as string | undefined }

    const target = await db.user.findUnique({ where: { id: appeal.userId } })
    before.userStatus = target?.status

    const updated = await db.appeal.update({
      where: { id: appeal.id },
      data: { status: data.decision === "UPHOLD" ? "UPHELD" : "REVERSED", decidedBy: user.id, decidedAt: now, decisionNote: data.note },
    })

    let enforcementLiftedAt: Date | null = null
    if (data.decision === "REVERSE") {
      // Reverse = lift the enforcement + restore account standing
      const enfNow = new Date()
      await db.enforcement.update({
        where: { id: enf.id },
        data: { liftedAt: enfNow, liftedBy: user.id, notes: `${enf.notes || ""}\n[appeal reversed] ${data.note}`.trim() },
      })
      enforcementLiftedAt = enfNow
      const stillActive = await db.enforcement.count({
        where: { userId: appeal.userId, liftedAt: null, level: { in: ["SUSPENSION", "BAN"] }, id: { not: enf.id } },
      })
      if (target && (target.status === "SUSPENDED" || target.status === "BANNED") && stillActive === 0) {
        await db.user.update({ where: { id: target.id }, data: { status: "ACTIVE", statusReason: null } })
      }
    }

    await notify(appeal.userId, data.decision === "REVERSE" ? "APPEAL_REVERSED" : "APPEAL_UPHELD", {
      appealId: appeal.id, note: data.note.slice(0, 200),
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: `appeal.${data.decision.toLowerCase()}`, targetType: "APPEAL", targetId: appeal.id,
      before: { status: before.status, enforcementLifted: before.enforcementLifted, userStatus: before.userStatus },
      after: { status: updated.status, enforcementLifted: !!enforcementLiftedAt },
      reason: data.note, requestId, ip,
    })
    return ok({ status: updated.status, enforcementLifted: !!enforcementLiftedAt }, requestId)
  } catch {
    return fail("Decision failed", 500, requestId)
  }
}
