// ── /api/v1 shared pipeline: api-key auth, per-key rate limit, request logging, envelopes ──
// The governed developer surface (API-001..020). Every response carries X-Request-Id.
// NOTE: inlines the requireApiKey() contract from @/lib/server/api because ApiKey→User has
// no Prisma relation defined (include unsupported); same semantics: hash lookup, revoked/suspended/scope checks.
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ctxFrom, json } from "@/lib/server/api"
import { rateLimit, sha256 } from "@/lib/server/auth-core"

export const V1_PUBLIC_STATUSES = ["ACTIVE", "ENDED", "SOLD"] as const

export type V1Key = {
  id: string
  userId: string
  name: string
  prefix: string
  ratePerMin: number
}

export function v1Json(body: unknown, requestId: string, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "X-Request-Id": requestId, ...(extraHeaders || {}) },
  })
}

export function v1Error(message: string, code: number, requestId: string, extraHeaders?: Record<string, string>) {
  return v1Json({ ok: false, error: { message, code }, requestId }, requestId, code, extraHeaders)
}

// Log every v1 call (success or failure) into ApiRequestLog (API-014 observability)
export async function logV1Call(input: {
  route: string
  method: string
  status: number
  startedAt: number
  requestId: string
  ip: string
  apiKeyId: string | null
}) {
  const latencyMs = Date.now() - input.startedAt
  try {
    await db.apiRequestLog.create({
      data: {
        apiKeyId: input.apiKeyId ?? null,
        route: input.route,
        method: input.method,
        status: input.status,
        latencyMs,
        requestId: input.requestId,
        ip: input.ip,
      },
    })
  } catch {
    // logging must never break the API response
  }
  return latencyMs
}

// Bearer key + scope + per-key rate limit in one step. Returns an error response on failure.
// Same contract as requireApiKey(): sha256 lookup, revoked/suspended/scope checks, lastUsedAt update.
async function authenticateKey(rawKey: string, scope: string) {
  try {
    const rec = await db.apiKey.findUnique({ where: { keyHash: sha256(rawKey) } })
    if (!rec || rec.revokedAt) return { error: "Invalid or revoked API key", key: null, rec: null }
    const user = await db.user.findUnique({ where: { id: rec.userId } })
    if (user && (user.status === "SUSPENDED" || user.status === "BANNED")) return { error: "Account suspended", key: null, rec: null }
    const scopes = json<string[]>(rec.scopes, [])
    if (!scopes.includes(scope) && !scopes.includes("admin")) return { error: `Key missing scope '${scope}'`, key: null, rec: null }
    await db.apiKey.update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } })
    return { error: null, key: rec, rec: null }
  } catch {
    return { error: "Invalid or revoked API key", key: null, rec: null }
  }
}

export async function v1Auth(req: NextRequest, route: string, scope: "read" | "admin") {
  const { requestId, ip } = ctxFrom(req)
  const startedAt = Date.now()

  const auth = req.headers.get("authorization") || ""
  if (!auth.startsWith("Bearer ") || !auth.slice(7).trim()) {
    await logV1Call({ route, method: req.method, status: 401, startedAt, requestId, ip, apiKeyId: null })
    return { key: null as V1Key | null, requestId, ip, startedAt, error: v1Error("Missing bearer API key. Create one in the developer console.", 401, requestId) }
  }

  const rawKey = auth.slice(7).trim()
  const { error: authError, key } = await authenticateKey(rawKey, scope)
  if (authError || !key) {
    const status = authError === "Account suspended" ? 403 : 401
    await logV1Call({ route, method: req.method, status, startedAt, requestId, ip, apiKeyId: null })
    return { key: null as V1Key | null, requestId, ip, startedAt, error: v1Error(authError || "Invalid or revoked API key", status, requestId) }
  }

  const v1Key: V1Key = { id: key.id, userId: key.userId, name: key.name, prefix: key.prefix, ratePerMin: key.ratePerMin }

  // Per-key rate limit (API-011): ratePerMin requests per rolling 60s window
  if (!rateLimit(`v1:${key.id}`, key.ratePerMin, 60_000)) {
    await logV1Call({ route, method: req.method, status: 429, startedAt, requestId, ip, apiKeyId: key.id })
    return {
      key: v1Key, requestId, ip, startedAt,
      error: v1Error(`Rate limit exceeded (${key.ratePerMin}/min). Retry shortly.`, 429, requestId, { "Retry-After": "60" }),
    }
  }

  return { key: v1Key, requestId, ip, startedAt, error: null }
}
