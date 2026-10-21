// GET /api/dev/webhooks/deliveries?endpointId — my webhook delivery history (auth)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const endpointId = req.nextUrl.searchParams.get("endpointId") || ""
  const mine = await db.webhookEndpoint.findMany({ where: { userId: user.id }, select: { id: true } })
  const myIds = new Set(mine.map((e) => e.id))

  if (endpointId && !myIds.has(endpointId)) return fail("Endpoint not found", 404, requestId)

  const deliveries = await db.webhookDelivery.findMany({
    where: endpointId ? { endpointId } : { endpointId: { in: [...myIds] } },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return ok({
    items: deliveries.map((d) => ({
      id: d.id,
      endpointId: d.endpointId,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      responseCode: d.responseCode,
      lastAttemptAt: d.lastAttemptAt,
      nextRetryAt: d.nextRetryAt,
      createdAt: d.createdAt,
    })),
    total: deliveries.length,
  }, requestId)
}
