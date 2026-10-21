// /api/admin/cms/articles — editorial list + create (CMS_ROLES per CMS-011..015)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, ctxFrom, paginate, parseBody, audit } from "@/lib/server/api"
import { guard, CMS_ROLES, userMap, listingSnapshot } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(CMS_ROLES, requestId)
  if (!user) return res
  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const where: Record<string, unknown> = {}
  const status = sp.get("status")?.trim()
  const type = sp.get("type")?.trim()
  const q = sp.get("q")?.trim()
  if (status && status !== "ALL") where.status = status
  if (type && type !== "ALL") where.type = type
  if (q) where.OR = [{ title: { contains: q } }, { slug: { contains: q } }]
  const [rows, total] = await Promise.all([
    db.article.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take: limit }),
    db.article.count({ where }),
  ])
  const names = await userMap(rows.flatMap(r => [r.authorId, r.reviewerId, r.publisherId].filter(Boolean) as string[]))
  const items = rows.map(r => ({
    ...r, body: undefined,
    authorName: names.get(r.authorId) || null, reviewerName: r.reviewerId ? names.get(r.reviewerId) || null : null,
    publisherName: r.publisherId ? names.get(r.publisherId) || null : null,
  }))
  return ok({ items, total, page, limit }, requestId)
}

const createSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  type: z.enum(["HELP", "POLICY", "ANNOUNCEMENT", "SELLER_DOC", "RUNBOOK", "KB", "ADR", "CHANGELOG", "API_DOC"]),
  title: z.string().trim().min(3).max(160),
  titleJa: z.string().trim().max(160).optional(),
  body: z.string().min(1).max(60000),
  bodyJa: z.string().max(60000).optional(),
  category: z.string().max(40).optional(),
  scheduledFor: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(CMS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, createSchema)
  if (error) return error
  const existing = await db.article.findUnique({ where: { slug: data.slug } })
  if (existing) return ok({ duplicate: true, id: existing.id }, requestId, 200)
  const art = await db.article.create({
    data: {
      slug: data.slug, type: data.type, title: data.title, titleJa: data.titleJa || data.title,
      body: data.body, bodyJa: data.bodyJa, authorId: user.id, status: "DRAFT",
      category: data.category, scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
    },
  })
  await db.articleVersion.create({
    data: { articleId: art.id, version: 1, snapshot: JSON.stringify(listingSnapshot ? undefined : undefined), changedBy: user.id, changeNote: "Created" },
  }).catch(() => undefined)
  await db.articleVersion.update({ where: { id: (await db.articleVersion.findFirst({ where: { articleId: art.id }, orderBy: { version: "asc" } }))!.id }, data: { snapshot: JSON.stringify({ title: art.title, status: art.status }) } }).catch(() => undefined)
  await audit({
    actorId: user.id, actorRole: user.role, action: "cms.article.create", targetType: "ARTICLE", targetId: art.id,
    after: { slug: art.slug, type: art.type, status: "DRAFT" }, requestId, ip,
  })
  return ok({ id: art.id, slug: art.slug, status: art.status }, requestId, 201)
}
