// /api/dev/keys — developer API key manager (auth): list masked, create (rate-limited), revoke
import { NextRequest } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, rateLimit, sha256 } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const hex = (n: number) => randomBytes(n).toString("hex")

// GET — my keys, masked (hash never leaves the server)
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const keys = await db.apiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } })
  return ok({
    items: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      masked: `${k.prefix}.${"*".repeat(8)}`,
      scopes: json<string[]>(k.scopes, []),
      ratePerMin: k.ratePerMin,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    })),
    total: keys.length,
  }, requestId)
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(["read", "admin"])).min(1),
  ratePerMin: z.number().int().min(1).max(120).default(60),
})

// POST — create a key; plaintext returned exactly once
export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const { data, error: bodyError } = await parseBody(req, createSchema)
  if (bodyError) return bodyError

  // Creation rate limit: 5 keys per user per day (API-017 abuse control)
  if (!rateLimit(`devkey:create:${user.id}`, 5, 24 * 3600 * 1000)) {
    return fail("API key creation limit reached (5 per day)", 429, requestId)
  }

  // prefix tga_live_ + 8 hex chars; secret 32 hex chars; full key `${prefix}.${secret}`
  let prefix = ""
  for (let i = 0; i < 5; i++) {
    const candidate = `tga_live_${hex(4)}`
    if (!(await db.apiKey.findUnique({ where: { prefix: candidate } }))) { prefix = candidate; break }
    prefix = candidate // extremely unlikely fallback
  }
  const secret = hex(16)
  const plaintext = `${prefix}.${secret}`

  const key = await db.apiKey.create({
    data: {
      userId: user.id,
      name: data.name,
      prefix,
      keyHash: sha256(plaintext),
      scopes: JSON.stringify(data.scopes),
      ratePerMin: data.ratePerMin,
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "apikey.create",
    targetType: "ApiKey",
    targetId: key.id,
    after: { name: data.name, prefix, scopes: data.scopes, ratePerMin: data.ratePerMin },
    requestId,
    ip,
  })

  return ok({
    key: {
      id: key.id,
      name: key.name,
      prefix,
      scopes: data.scopes,
      ratePerMin: key.ratePerMin,
      createdAt: key.createdAt,
    },
    plaintext, // shown once, never stored
  }, requestId, 201)
}

// DELETE ?id= — revoke my key
export async function DELETE(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const id = req.nextUrl.searchParams.get("id") || ""
  const key = await db.apiKey.findUnique({ where: { id } })
  if (!key || key.userId !== user.id) return fail("Key not found", 404, requestId)
  if (key.revokedAt) return fail("Key already revoked", 409, requestId)

  const updated = await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "apikey.revoke",
    targetType: "ApiKey",
    targetId: id,
    before: { prefix: key.prefix, revokedAt: null },
    after: { prefix: updated.prefix, revokedAt: updated.revokedAt },
    requestId,
    ip,
  })

  return ok({ key: { id: updated.id, revokedAt: updated.revokedAt } }, requestId)
}
