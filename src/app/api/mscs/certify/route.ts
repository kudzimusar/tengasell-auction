// POST /api/mscs/certify — run the certification gate engine (ADMIN only)
// Computes disposition from live registry data and issues the Template D record.
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"
import { runCertificationGate } from "../_lib"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, error } = await requireUser(["ADMIN"])
  if (error === 401) return fail("Sign in required", 401, requestId)
  if (error || !user) return fail("Admin role required to run certification", 403, requestId)

  const result = await runCertificationGate({ id: user.id, role: user.role })

  await db.appLog.create({
    data: {
      level: "info",
      source: "mscs",
      message: `certification-run ${result.certification.id} → ${result.certification.disposition} (score ${result.score})`,
      context: JSON.stringify({ gates: { A: result.gates.A.passed, B: result.gates.B.passed, C: result.gates.C.passed, D: result.gates.D.passed } }),
      requestId,
    },
  }).catch(() => undefined)

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "mscs.certify",
    targetType: "MscsCertification",
    targetId: result.certification.id,
    before: { disposition: null },
    after: {
      disposition: result.certification.disposition,
      weightedScore: result.score,
      gatesPassed: result.certification.gatesPassed,
      conditions: result.certification.conditions.length,
    },
    requestId,
    ip,
  })

  return ok(result, requestId, 201)
}
