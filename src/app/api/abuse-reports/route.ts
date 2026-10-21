// POST /api/abuse-reports — signed-in users report listings/users/messages/reviews (T&S intake)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const reportSchema = z.object({
  targetType: z.enum(["LISTING", "USER", "MESSAGE", "REVIEW"]),
  targetId: z.string().min(1).max(64),
  reason: z.enum(["PROHIBITED", "COUNTERFEIT", "SCAM", "ABUSE", "SPAM", "OTHER"]),
  details: z.string().trim().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in to report", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)

  const { data, error: bodyErr } = await parseBody(req, reportSchema)
  if (bodyErr) return bodyErr

  try {
    const report = await db.abuseReport.create({
      data: {
        reporterId: user.id,
        targetType: data.targetType,
        targetId: data.targetId,
        reason: data.reason,
        details: data.details || undefined,
        status: "OPEN",
      },
    })
    await audit({
      actorId: user.id, actorRole: user.role, action: "abuse.report", targetType: data.targetType, targetId: data.targetId,
      after: { reportId: report.id, reason: data.reason }, requestId, ip,
    })
    return ok({ id: report.id, status: report.status }, requestId, 201)
  } catch {
    return fail("Could not submit report", 500, requestId)
  }
}
