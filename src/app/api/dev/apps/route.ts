// /api/dev/apps — OAuth-style developer apps (auth): list, create (secret once), delete
import { NextRequest } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, json } from "@/lib/server/api"
import { requireUser, sha256 } from "@/lib/server/auth-core"

export const runtime = "nodejs"

const hex = (n: number) => randomBytes(n).toString("hex")

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const apps = await db.developerApp.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } })
  return ok({
    items: apps.map((a) => ({
      id: a.id,
      name: a.name,
      clientId: a.clientId,
      redirectUris: json<string[]>(a.redirectUris, []),
      sandbox: a.sandbox,
      status: a.status,
      createdAt: a.createdAt,
    })),
    total: apps.length,
  }, requestId)
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  redirectUris: z.array(z.string().url()).max(5).default([]),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const { data, error: bodyError } = await parseBody(req, createSchema)
  if (bodyError) return bodyError

  const clientId = `tga_app_${hex(8)}`
  const clientSecret = `tga_cs_${hex(16)}` // plaintext returned once; only hash stored
  const app = await db.developerApp.create({
    data: {
      userId: user.id,
      name: data.name,
      clientId,
      clientSecretHash: sha256(clientSecret),
      redirectUris: JSON.stringify(data.redirectUris),
      scopes: JSON.stringify(["read"]),
      sandbox: true,
    },
  })

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "devapp.create",
    targetType: "DeveloperApp",
    targetId: app.id,
    after: { name: data.name, clientId },
    requestId,
    ip,
  })

  return ok({
    app: { id: app.id, name: app.name, clientId, redirectUris: data.redirectUris, createdAt: app.createdAt },
    clientSecret, // once
  }, requestId, 201)
}

export async function DELETE(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Account unavailable", 403, requestId)

  const id = req.nextUrl.searchParams.get("id") || ""
  const app = await db.developerApp.findUnique({ where: { id } })
  if (!app || app.userId !== user.id) return fail("App not found", 404, requestId)

  await db.developerApp.delete({ where: { id } })
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "devapp.delete",
    targetType: "DeveloperApp",
    targetId: id,
    before: { name: app.name, clientId: app.clientId },
    requestId,
    ip,
  })

  return ok({ deleted: id }, requestId)
}
