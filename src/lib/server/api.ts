// ── API helpers: envelope, requestId, audit, validation, api-key auth ──
import { NextRequest, NextResponse } from "next/server"
import { z, ZodType } from "zod"
import { db } from "@/lib/db"
import { sha256 } from "./auth-core"

export type ApiCtx = {
  req: NextRequest
  requestId: string
  ip: string
}

export function ok<T>(data: T, requestId?: string, status = 200) {
  return NextResponse.json({ ok: true, data, requestId }, { status })
}

export function fail(message: string, code = 400, requestId?: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { message, code }, requestId, details }, { status: code })
}

export function ctxFrom(req: NextRequest): ApiCtx {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID()
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"
  return { req, requestId, ip }
}

export async function parseBody<S extends ZodType>(req: NextRequest, schema: S): Promise<{ data: z.infer<S>; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown
  try { raw = await req.json() } catch { return { data: null, error: fail("Invalid JSON body", 400) } }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { data: null, error: fail("Validation failed", 422, undefined, parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message }))) }
  }
  return { data: parsed.data, error: null }
}

// Append-only audit trail (CTL-018). Never used for reads of secrets.
export async function audit(input: {
  actorId?: string | null
  actorRole?: string | null
  action: string
  targetType?: string
  targetId?: string
  before?: unknown
  after?: unknown
  reason?: string
  requestId?: string
  ip?: string
}) {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? undefined,
        actorRole: input.actorRole ?? undefined,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before === undefined ? undefined : JSON.stringify(input.before),
        after: input.after === undefined ? undefined : JSON.stringify(input.after),
        reason: input.reason,
        requestId: input.requestId,
        ip: input.ip,
      },
    })
  } catch {
    // Audit must never break the request path; log to AppLog as fallback
    try {
      await db.appLog.create({ data: { level: "error", source: "audit", message: `audit-fail ${input.action}` } })
    } catch { /* last resort: silent */ }
  }
}

// Developer API-key authentication (API-002). Key format: tga_live_<prefix>_<secret>
export async function requireApiKey(req: NextRequest, scope: string) {
  const auth = req.headers.get("authorization") || ""
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : null
  if (!key) return { error: fail("Missing bearer API key", 401), key: null }
  const keyHash = sha256(key)
  const rec = await db.apiKey.findUnique({ where: { keyHash }, include: { user: true } })
  if (!rec || rec.revokedAt) return { error: fail("Invalid or revoked API key", 401), key: null }
  if (rec.user && (rec.user.status === "SUSPENDED" || rec.user.status === "BANNED")) return { error: fail("Account suspended", 403), key: null }
  const scopes = JSON.parse(rec.scopes || "[]") as string[]
  if (!scopes.includes(scope) && !scopes.includes("admin")) return { error: fail(`Key missing scope '${scope}'`, 403), key: null }
  await db.apiKey.update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } })
  return { error: null, key: rec }
}

export function paginate(searchParams: URLSearchParams, defaultLimit = 20) {
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || defaultLimit), 1), 100)
  const page = Math.max(Number(searchParams.get("page") || 1), 1)
  return { limit, page, skip: (page - 1) * limit }
}

export function json<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}
