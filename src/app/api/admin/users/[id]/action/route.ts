// POST /api/admin/users/[id]/action — SUSPEND|RESTORE|BAN|REQUIRE_RESET|GRANT_ROLE (SUPPORT+; GRANT_ROLE admin-only)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, STAFF_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["SUSPEND", "RESTORE", "BAN", "REQUIRE_RESET", "GRANT_ROLE"]),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
  role: z.enum(["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"]).optional(),
  expiresAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  if (data.action === "GRANT_ROLE" && user.role !== "ADMIN") {
    return fail("Only an admin may grant staff roles", 403, requestId)
  }

  try {
    const target = await db.user.findUnique({ where: { id } })
    if (!target) return fail("User not found", 404, requestId)
    if (target.id === user.id && data.action !== "REQUIRE_RESET") {
      return fail("You cannot apply this action to your own account", 422, requestId)
    }

    const before = { status: target.status, role: target.role, statusReason: target.statusReason || null }
    const now = new Date()
    const reason = `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`

    if (data.action === "GRANT_ROLE") {
      if (!data.role) return fail("Role is required for GRANT_ROLE", 422, requestId)
      const grant = await db.staffGrant.create({
        data: {
          userId: target.id, role: data.role, grantedBy: user.id,
          reason: reason, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        },
      })
      await db.user.update({ where: { id: target.id }, data: { role: data.role } })
      await notify(target.id, "ROLE_GRANTED", { role: data.role, reason: data.reasonCode })
      await audit({
        actorId: user.id, actorRole: user.role, action: "user.grant_role", targetType: "USER", targetId: target.id,
        before, after: { role: data.role, grantId: grant.id, expiresAt: grant.expiresAt }, reason, requestId, ip,
      })
      return ok({ grantId: grant.id, role: data.role }, requestId)
    }

    if (data.action === "REQUIRE_RESET") {
      const { sha256 } = await import("@/lib/server/auth-core")
      const token = `rst_${crypto.randomUUID().replace(/-/g, "")}`
      await db.passwordResetToken.create({
        data: { userId: target.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + 24 * 3600_000) },
      })
      await db.sessionRecord.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } })
      await notify(target.id, "PASSWORD_RESET_REQUIRED", { reason: data.reasonCode })
      await audit({
        actorId: user.id, actorRole: user.role, action: "user.require_reset", targetType: "USER", targetId: target.id,
        before: { sessionsActive: true }, after: { sessionsRevoked: true, expiresAt: now.toISOString() }, reason, requestId, ip,
      })
      return ok({ issued: true }, requestId)
    }

    const newStatus = data.action === "SUSPEND" ? "SUSPENDED" : data.action === "BAN" ? "BANNED" : "ACTIVE"
    if (data.action === "RESTORE" && !["SUSPENDED", "BANNED"].includes(target.status)) {
      return fail("Account is not suspended or banned", 422, requestId)
    }
    if (data.action !== "RESTORE" && target.status === newStatus) {
      return fail(`Account is already ${newStatus}`, 422, requestId)
    }

    const updated = await db.user.update({
      where: { id: target.id },
      data: { status: newStatus, statusReason: data.action === "RESTORE" ? null : reason },
    })
    // Revoke all sessions on suspend/ban
    if (newStatus !== "ACTIVE") {
      await db.sessionRecord.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } })
    }
    await notify(target.id, data.action === "RESTORE" ? "ACCOUNT_RESTORED" : `ACCOUNT_${data.action}`, {
      status: newStatus, reason: data.reasonCode,
    })
    await audit({
      actorId: user.id, actorRole: user.role, action: `user.${data.action.toLowerCase()}`, targetType: "USER", targetId: target.id,
      before, after: { status: updated.status, statusReason: updated.statusReason }, reason, requestId, ip,
    })
    return ok({ status: updated.status }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
