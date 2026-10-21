import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/server/auth-core"
import { ok, fail, ctxFrom } from "@/lib/server/api"

// GET /api/notifications — list for current user; ?unread=1 returns {count} only
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  if (req.nextUrl.searchParams.get("unread") === "1") {
    const count = await db.notification.count({ where: { userId: user.id, readAt: null } })
    return ok({ count }, requestId)
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 50), 100)
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit })
  return ok({ items, unread: items.filter(i => !i.readAt).length }, requestId)
}

// POST /api/notifications — {ids?: string[], all?: boolean} mark read
export async function POST(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user } = await requireUser()
  if (!user) return fail("Sign in required", 401, requestId)
  const body = await req.json().catch(() => ({}))
  if (body?.all) {
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
  } else if (Array.isArray(body?.ids)) {
    await db.notification.updateMany({ where: { id: { in: body.ids }, userId: user.id }, data: { readAt: new Date() } })
  }
  return ok({ done: true }, requestId)
}
