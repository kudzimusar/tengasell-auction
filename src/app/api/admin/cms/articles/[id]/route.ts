// /api/admin/cms/articles/[id] — detail + versions; PATCH edits & workflow transitions (audited)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, CMS_ROLES } from "../../../_lib/ctl"

export const runtime = "nodejs"

type Transition = "submit" | "review" | "approve" | "publish" | "unpublish" | "archive"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(CMS_ROLES, requestId)
  if (!user) return res
  const art = await db.article.findUnique({ where: { id } })
  if (!art) return fail("Article not found", 404, requestId)
  const versions = await db.articleVersion.findMany({ where: { articleId: id }, orderBy: { version: "desc" }, take: 20 })
  return ok({ article: art, versions }, requestId)
}

const patchSchema = z.object({
  action: z.enum(["edit", "submit", "review", "approve", "publish", "unpublish", "archive"]).optional(),
  title: z.string().trim().min(3).max(160).optional(),
  titleJa: z.string().trim().max(160).optional(),
  body: z.string().max(60000).optional(),
  bodyJa: z.string().max(60000).optional(),
  category: z.string().max(40).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  note: z.string().max(300).optional(),
})

const FLOW: Record<string, { from: string[]; to: (a: { scheduledFor: Date | null }) => { status: string; publisherId?: string; publishedAt?: Date; reviewerId?: string; scheduledFor?: Date | null } }> = {
  submit: { from: ["DRAFT"], to: () => ({ status: "IN_REVIEW" }) },
  approve: { from: ["IN_REVIEW"], to: (a) => ({ status: a.scheduledFor ? "SCHEDULED" : "PUBLISHED", reviewerId: undefined, publishedAt: a.scheduledFor ? undefined : new Date() }) },
  publish: { from: ["APPROVED", "SCHEDULED", "UNPUBLISHED"], to: () => ({ status: "PUBLISHED", publishedAt: new Date() }) },
  unpublish: { from: ["PUBLISHED"], to: () => ({ status: "UNPUBLISHED" }) },
  archive: { from: ["PUBLISHED", "UNPUBLISHED"], to: () => ({ status: "ARCHIVED" }) },
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(CMS_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, patchSchema)
  if (error) return error
  const art = await db.article.findUnique({ where: { id } })
  if (!art) return fail("Article not found", 404, requestId)
  const before = { title: art.title, status: art.status, version: art.version, bodyLen: art.body.length }
  const note = data.note || ""

  let update: Record<string, unknown> = {}
  let action = `cms.article.${data.action || "edit"}`
  if (data.action && data.action !== "edit") {
    const t = FLOW[data.action as Transition & "submit"]
    if (!t) return fail("Unknown transition", 422, requestId)
    if (!t.from.includes(art.status)) return fail(`Cannot ${data.action} from ${art.status}`, 422, requestId)
    const scheduledFor = data.scheduledFor !== undefined ? (data.scheduledFor ? new Date(data.scheduledFor) : null) : art.scheduledFor
    const eff = t.to({ scheduledFor })
    update = { ...eff, scheduledFor, publisherId: eff.status === "PUBLISHED" ? user.id : art.publisherId, reviewerId: data.action === "approve" ? user.id : art.reviewerId }
  }
  const edits: Record<string, unknown> = {}
  if (data.title) edits.title = data.title
  if (data.titleJa) edits.titleJa = data.titleJa
  if (data.body) edits.body = data.body
  if (data.bodyJa !== undefined) edits.bodyJa = data.bodyJa
  if (data.category !== undefined) edits.category = data.category
  const edited = Object.keys(edits).length > 0

  if (edited) {
    await db.articleVersion.create({
      data: { articleId: art.id, version: art.version, snapshot: JSON.stringify({ title: art.title, status: art.status, bodyLen: art.body.length }), changedBy: user.id, changeNote: note || "edited" },
    }).catch(() => undefined)
    update.version = { increment: 1 }
    update = { ...edits, ...update }
    action = data.action && data.action !== "edit" ? action : "cms.article.edit"
  }
  const after = await db.article.update({ where: { id }, data: update })
  await audit({
    actorId: user.id, actorRole: user.role, action, targetType: "ARTICLE", targetId: art.id,
    before, after: { title: after.title, status: after.status, version: after.version, edited: Object.keys(edits) },
    reason: note || undefined, requestId, ip,
  })
  return ok({ id: art.id, status: after.status, version: after.version }, requestId)
}
