// /api/admin/privacy/dsar/[id]/action — COMPLETE | REJECT with resultRef (PRV rights workflow)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, PRIVACY_ROLES } from "../../../../_lib/ctl"

export const runtime = "nodejs"

const schema = z.object({
  action: z.enum(["COMPLETE", "REJECT"]),
  resultRef: z.string().trim().max(300).optional(),
  note: z.string().max(500).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(PRIVACY_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const d = await db.dsarRequest.findUnique({ where: { id } })
  if (!d) return fail("DSAR not found", 404, requestId)
  if (d.status === "COMPLETED") return fail("Already completed", 409, requestId)

  if (data.action === "COMPLETE" && d.type === "DELETION") {
    // Execute account anonymisation (statutory retention exceptions preserved: financial records)
    const target = await db.user.findUnique({ where: { id: d.userId } })
    if (target && target.status !== "DELETED") {
      await db.user.update({
        where: { id: target.id },
        data: {
          status: "DELETED", deletedAt: new Date(),
          email: `deleted+${target.id}@tengasell.invalid`, handle: `deleted_${target.id.slice(-8)}`,
          name: "Deleted User", phone: null, bio: null, city: null, avatarEmoji: "🗑️",
          passwordHash: "deleted", deletionReason: d.details || "DSAR deletion",
        },
      })
      await db.sessionRecord.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } })
    }
  }
  const after = await db.dsarRequest.update({
    where: { id },
    data: {
      status: data.action === "COMPLETE" ? "COMPLETED" : "REJECTED",
      completedAt: data.action === "COMPLETE" ? new Date() : undefined,
      resultRef: data.resultRef || (data.action === "COMPLETE" ? "fulfilled via admin console" : undefined),
    },
  })
  await db.notification.create({
    data: { userId: d.userId, type: "DSAR_UPDATE", params: JSON.stringify({ type: d.type, status: after.status }) },
  }).catch(() => undefined)
  await audit({
    actorId: user.id, actorRole: user.role, action: "privacy.dsar." + data.action.toLowerCase(), targetType: "DSAR", targetId: id,
    before: { status: d.status }, after: { status: after.status, resultRef: after.resultRef }, reason: data.note, requestId, ip,
  })
  return ok(after, requestId)
}
