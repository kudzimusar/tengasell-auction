// /api/dev/webhooks — developer webhook endpoints (auth): list + deliveries, create (secret once), delete
import { NextRequest } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const hex = (n: number) => randomBytes(n).toString("hex")
const EVENTS = ["bid.placed", "order.paid", "order.shipped", "dispute.opened", "auction.won"] as const

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const endpoints = await db.webhookEndpoint.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } })
  const ids = endpoints.map((e) => e.id)
  const deliveries = ids.length
    ? await db.webhookDelivery.findMany({ where: { endpointId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 20 })
    : []

  return ok({
    endpoints: endpoints.map((e) => ({
      id: e.id,
      url: e.url,
      events: json<string[]>(e.events, []),
      status: e.status,
      failureCount: e.failureCount,
      secretMasked: e.secret ? `${e.secret.slice(0, 9)}…` : null,
      createdAt: e.createdAt,
    })),
    deliveries: deliveries.map((d) => ({
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
  }, requestId)
}

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(EVENTS)).min(1),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const { data, error: bodyError } = await parseBody(req, createSchema)
  if (bodyError) return bodyError

  const secret = `whsec_${hex(16)}` // returned once; stored for HMAC signing
  const endpoint = await db.webhookEndpoint.create({
    data: {
      userId: user.id,
      url: data.url,
      secret,
      events: JSON.stringify(data.events),
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "webhook.create",
    targetType: "WebhookEndpoint",
    targetId: endpoint.id,
    after: { url: data.url, events: data.events },
    requestId,
    ip,
  })

  return ok({
    endpoint: { id: endpoint.id, url: endpoint.url, events: data.events, createdAt: endpoint.createdAt },
    secret, // once
  }, requestId, 201)
}

export async function DELETE(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const id = req.nextUrl.searchParams.get("id") || ""
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id } })
  if (!endpoint || endpoint.userId !== user.id) return fail("Endpoint not found", 404, requestId)

  await db.webhookDelivery.deleteMany({ where: { endpointId: id } })
  await db.webhookEndpoint.delete({ where: { id } })
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "webhook.delete",
    targetType: "WebhookEndpoint",
    targetId: id,
    before: { url: endpoint.url },
    requestId,
    ip,
  })

  return ok({ deleted: id }, requestId)
}
