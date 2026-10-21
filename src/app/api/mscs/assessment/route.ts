// GET /api/mscs/assessment — latest assessment with parsed Template A declaration (read: any staff)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)

  const assessment = await db.mscsAssessment.findFirst({ orderBy: { startedAt: "desc" } })
  if (!assessment) return fail("No assessment on record", 404, requestId)

  return ok({
    assessment: {
      ...assessment,
      declaration: json<Record<string, unknown>>(assessment.declaration, {}),
      gates: json<Record<string, boolean>>(assessment.gates, {}),
    },
  }, requestId)
}
