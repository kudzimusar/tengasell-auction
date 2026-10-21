// /api/admin/config — flags, settings, reason codes (GET: OPS_ROLES read)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../_lib/ctl"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const [flags, settings, reasonCodes] = await Promise.all([
    db.featureFlag.findMany({ orderBy: { key: "asc" } }),
    db.configSetting.findMany({ orderBy: { key: "asc" } }),
    db.reasonCode.findMany({ where: { active: true }, orderBy: { key: "asc" } }),
  ])
  return ok({ flags, settings, reasonCodes }, requestId)
}
