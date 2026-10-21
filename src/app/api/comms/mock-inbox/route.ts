import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireUser, STAFF_ROLES, Role } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

// Sandbox "provider viewer" for the mock email outbox (MSG-009 delivery-status evidence).
// Every user can view their own outbox; staff can view all rows.

// ── GET /api/comms/mock-inbox — rows; ?open=<id> returns full body + tracks open/click ──
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const isStaff = STAFF_ROLES.includes(user.role as Role)
  const sp = req.nextUrl.searchParams
  const mine = sp.get("mine") === "1"
  const kind = sp.get("kind")
  const openId = sp.get("open")

  if (openId) {
    const row = await db.emailOutbox.findUnique({ where: { id: openId } })
    if (!row) return fail("Email not found", 404, requestId)
    if (row.userId !== user.id && !isStaff) return fail("You don't have access to this email", 403, requestId)
    const openedAt = row.openedAt ?? new Date()
    const clickedAt = row.clickedAt ?? new Date()
    if (!row.openedAt || !row.clickedAt) {
      await db.emailOutbox.update({ where: { id: row.id }, data: { openedAt, clickedAt } })
    }
    return ok({ email: { ...row, openedAt, clickedAt } }, requestId)
  }

  // List rows: staff see all unless ?mine=1; everyone else sees their own outbox.
  const scope = isStaff && !mine ? "ALL" : "MINE"
  const where =
    scope === "ALL"
      ? kind === "TRANSACTIONAL" || kind === "MARKETING" ? { kind } : {}
      : kind === "TRANSACTIONAL" || kind === "MARKETING"
        ? { userId: user.id, kind }
        : { userId: user.id }
  const rows = await db.emailOutbox.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  const items = rows.map(r => ({
    id: r.id,
    status: r.status,
    kind: r.kind,
    subject: r.subject,
    toEmail: r.toEmail,
    templateKey: r.templateKey,
    campaignId: r.campaignId,
    sentAt: r.sentAt,
    openedAt: r.openedAt,
    clickedAt: r.clickedAt,
    unsubToken: r.unsubToken,
    createdAt: r.createdAt,
  }))
  return ok({ items, scope, isStaff }, requestId)
}
