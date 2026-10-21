import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

// POST /api/account/delete — soft-delete request with 30-day grace (PRV-006).
// Anonymisation itself is finalised by the compliance console after the grace window.
const schema = z.object({ reason: z.string().max(500).optional() })

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  if (user.status === "DELETION_PENDING") {
    return ok({ status: "DELETION_PENDING", alreadyRequested: true, graceDays: 30 }, requestId)
  }
  const anonymizeAt = new Date(Date.now() + 30 * 24 * 3_600_000)
  const reason = data.reason?.trim() || "user_requested"
  await db.user.update({
    where: { id: user.id },
    data: {
      status: "DELETION_PENDING",
      statusReason: "User requested account deletion",
      deletionReason: `${reason} (anonymisation scheduled for ${anonymizeAt.toISOString().slice(0, 10)} — 30-day grace, cancellable by signing in)`,
    },
  })
  await db.notification.create({
    data: {
      userId: user.id,
      type: "ACCOUNT_DELETE",
      params: JSON.stringify({ graceDays: 30, anonymizeAt: anonymizeAt.toISOString() }),
    },
  }).catch(() => undefined)
  await audit({
    actorId: user.id, actorRole: user.role, action: "account.delete_request",
    targetType: "USER", targetId: user.id,
    before: { status: user.status },
    after: { status: "DELETION_PENDING" },
    reason,
    requestId, ip,
  })
  return ok(
    {
      status: "DELETION_PENDING",
      graceDays: 30,
      anonymizeAt,
      consequences: [
        "Your account enters a 30-day grace period — sign in again to cancel.",
        "Your listings are hidden and you can't bid or sell during the grace period.",
        "After 30 days personal data is anonymised or erased per the retention schedule.",
        "Orders and tax records are retained as required by Zimbabwean tax law.",
      ],
    },
    requestId
  )
}
