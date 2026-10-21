// /api/admin/ops/backups — list + latest status (BCP-004 evidence surface)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const items = await db.backupRun.findMany({ orderBy: { createdAt: "desc" }, take: 20 })
  const restores = await db.restoreTest.findMany({ orderBy: { performedAt: "desc" }, take: 5 })
  return ok({ items, lastRestoreTests: restores }, requestId)
}
