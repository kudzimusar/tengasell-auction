// /api/admin/ops/backups/run — trigger manual backup now (BCP-004)
import { NextRequest } from "next/server"
import { ok, ctxFrom, audit } from "@/lib/server/api"
import { guard, OPS_ROLES } from "../../../_lib/ctl"
import { runBackup } from "@/lib/server/scheduler"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(OPS_ROLES, requestId)
  if (!user) return res
  const run = await runBackup("MANUAL")
  await audit({
    actorId: user.id, actorRole: user.role, action: "ops.backup.run", targetType: "BACKUP", targetId: run?.id,
    after: { status: run?.status, storageRef: run?.storageRef }, reason: "manual run", requestId, ip,
  })
  if (!run) return ok({ status: "FAILED" }, requestId)
  return ok(run, requestId, 201)
}
