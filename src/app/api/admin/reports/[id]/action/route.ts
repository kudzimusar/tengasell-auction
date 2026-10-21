// POST /api/admin/reports/[id]/action — DISMISS | ACTION with enforcement ladder (MODERATOR+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, MOD_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["DISMISS", "ACTION"]),
  enforcementLevel: z.enum(["WARNING", "RESTRICTION", "SUSPENSION", "BAN"]).optional(),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const report = await db.abuseReport.findUnique({ where: { id } })
    if (!report) return fail("Report not found", 404, requestId)
    if (report.status !== "OPEN" && report.status !== "REVIEWING") {
      return fail(`Report already ${report.status.toLowerCase()}`, 422, requestId)
    }

    const now = new Date()
    const reason = `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`

    if (data.action === "DISMISS") {
      const updated = await db.abuseReport.update({
        where: { id },
        data: { status: "DISMISSED", handledBy: user.id, resolvedAt: now, actionTaken: `DISMISSED: ${reason}` },
      })
      if (report.reporterId) {
        await notify(report.reporterId, "REPORT_REVIEWED", { reportId: report.id, outcome: "DISMISSED" })
      }
      await audit({
        actorId: user.id, actorRole: user.role, action: "report.dismiss", targetType: "REPORT", targetId: report.id,
        before: { status: report.status }, after: { status: updated.status }, reason, requestId, ip,
      })
      return ok({ status: updated.status }, requestId)
    }

    // ACTION — resolve the target owner (users own listings/messages/reviews)
    let targetUserId: string | null = null
    if (report.targetType === "USER") targetUserId = report.targetId
    else if (report.targetType === "LISTING") {
      const l = await db.listing.findUnique({ where: { id: report.targetId } })
      targetUserId = l?.sellerId || null
    } else if (report.targetType === "MESSAGE") {
      const m = await db.message.findUnique({ where: { id: report.targetId } })
      targetUserId = m?.senderId || null
    } else if (report.targetType === "REVIEW") {
      const r = await db.review.findUnique({ where: { id: report.targetId } })
      targetUserId = r?.authorId || null
    }
    if (!targetUserId) return fail("Could not resolve the report target owner", 422, requestId)

    // Enforcement record (if a level was chosen)
    let enforcementId: string | null = null
    if (data.enforcementLevel) {
      const enf = await db.enforcement.create({
        data: {
          userId: targetUserId, level: data.enforcementLevel, reason,
          reportId: report.id, issuedBy: user.id, notes: data.note,
        },
      })
      enforcementId = enf.id

      // Account state changes for the heavy end of the ladder
      if (data.enforcementLevel === "SUSPENSION") {
        await db.user.update({ where: { id: targetUserId }, data: { status: "SUSPENDED", statusReason: reason } })
      } else if (data.enforcementLevel === "BAN") {
        await db.user.update({ where: { id: targetUserId }, data: { status: "BANNED", statusReason: reason } })
      }
      if (data.enforcementLevel === "SUSPENSION" || data.enforcementLevel === "BAN") {
        await db.sessionRecord.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now } })
      }
    }

    // Content takedowns
    if (report.targetType === "LISTING") {
      const l = await db.listing.findUnique({ where: { id: report.targetId } })
      if (l && l.status === "ACTIVE") {
        await db.listing.update({ where: { id: l.id }, data: { status: "SUSPENDED", rejectReason: reason } })
      }
    } else if (report.targetType === "MESSAGE") {
      await db.message.update({ where: { id: report.targetId }, data: { redacted: true, moderationNote: reason } }).catch(() => undefined)
    } else if (report.targetType === "REVIEW") {
      await db.review.update({ where: { id: report.targetId }, data: { status: "HIDDEN", moderationNote: reason } }).catch(() => undefined)
    }

    const updated = await db.abuseReport.update({
      where: { id },
      data: {
        status: "ACTIONED", handledBy: user.id, resolvedAt: now,
        actionTaken: `${data.enforcementLevel || "REVIEW"}: ${reason}`,
      },
    })

    // Notify reporter + target
    if (report.reporterId) await notify(report.reporterId, "REPORT_ACTIONED", { reportId: report.id, outcome: data.enforcementLevel || "REVIEWED" })
    await notify(targetUserId, "ENFORCEMENT_APPLIED", { level: data.enforcementLevel || "REVIEW", reason: data.reasonCode })

    await audit({
      actorId: user.id, actorRole: user.role, action: "report.action", targetType: "REPORT", targetId: report.id,
      before: { status: report.status },
      after: { status: updated.status, enforcementId, level: data.enforcementLevel || null, targetUserId },
      reason, requestId, ip,
    })
    return ok({ status: updated.status, enforcementId, level: data.enforcementLevel || null }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
