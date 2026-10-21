// GET /api/dev/logs — my API request log (auth), last 100 rows
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

  const keys = await db.apiKey.findMany({ where: { userId: user.id }, select: { id: true, name: true, prefix: true } })
  const keyMap = new Map(keys.map((k) => [k.id, k]))
  const ids = [...keyMap.keys()]

  const logs = ids.length
    ? await db.apiRequestLog.findMany({
        where: { apiKeyId: { in: ids } },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : []

  return ok({
    items: logs.map((l) => ({
      id: l.id,
      route: l.route,
      method: l.method,
      status: l.status,
      latencyMs: l.latencyMs,
      requestId: l.requestId,
      ip: l.ip,
      keyName: l.apiKeyId ? keyMap.get(l.apiKeyId)?.name ?? null : null,
      keyPrefix: l.apiKeyId ? keyMap.get(l.apiKeyId)?.prefix ?? null : null,
      createdAt: l.createdAt,
    })),
    total: logs.length,
  }, requestId)
}
