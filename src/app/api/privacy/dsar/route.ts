import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"

export const runtime = "nodejs"

// GET /api/privacy/dsar — my data-subject requests
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const items = await db.dsarRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  })
  return ok({ items }, requestId)
}

// POST /api/privacy/dsar — submit a new request (30-day statutory deadline)
const schema = z.object({
  type: z.enum(["ACCESS", "CORRECTION", "DELETION", "PORTABILITY", "RESTRICTION", "OBJECTION"]),
  details: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const dueAt = new Date(Date.now() + 30 * 24 * 3_600_000)
  const dsar = await db.dsarRequest.create({
    data: {
      userId: user.id,
      type: data.type,
      details: data.details?.trim() || undefined,
      status: "SUBMITTED",
      identityVerified: true, // logged-in session is the identity check in this sandbox
      dueAt,
    },
  })
  await audit({
    actorId: user.id, actorRole: user.role, action: "privacy.dsar_request",
    targetType: "DSAR", targetId: dsar.id,
    after: { type: data.type, dueAt },
    requestId, ip,
  })
  // Notify the compliance officer (compliance@tengasell.co.zw)
  const compliance = await db.user.findUnique({ where: { email: "compliance@tengasell.co.zw" } })
  if (compliance) {
    await db.notification.create({
      data: {
        userId: compliance.id,
        type: "DSAR_NEW",
        params: JSON.stringify({ dsarId: dsar.id, type: data.type, fromName: user.name, fromHandle: user.handle }),
      },
    }).catch(() => undefined)
  }
  return ok({ dsar }, requestId, 201)
}
