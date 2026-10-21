// GET /api/mscs/summary — registry-wide readiness rollup (read: any staff)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { requireUser, STAFF_ROLES } from "@/lib/server/auth-core"
import { registrySnapshot } from "../_lib"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, error } = await requireUser(STAFF_ROLES)
  if (error === 401) return fail("Staff sign-in required", 401, requestId)
  if (error || !user) return fail("Staff role required", 403, requestId)

  const { rows, applicable, readyCount, scorePct, criticalBelow } = await registrySnapshot()

  const byApplicability: Record<string, number> = { R: 0, C: 0, NA: 0, F: 0 }
  const byStatus: Record<string, number> = {}
  const domainMap = new Map<string, { domain: string; domainName: string; total: number; byStatus: Record<string, number>; applicable: number; ready: number }>()

  for (const c of rows) {
    byApplicability[c.applicability] = (byApplicability[c.applicability] || 0) + 1
    byStatus[c.status] = (byStatus[c.status] || 0) + 1
    let d = domainMap.get(c.domain)
    if (!d) {
      d = { domain: c.domain, domainName: c.domainName, total: 0, byStatus: {}, applicable: 0, ready: 0 }
      domainMap.set(c.domain, d)
    }
    d.total++
    d.byStatus[c.status] = (d.byStatus[c.status] || 0) + 1
    if (c.applicability === "R" || c.applicability === "C") {
      d.applicable++
      if (parseInt(c.status.slice(1), 10) >= 60) d.ready++
    }
  }

  const domains = Array.from(domainMap.values())
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((d) => ({ ...d, scorePct: d.applicable === 0 ? 100 : Math.round((d.ready / d.applicable) * 1000) / 10 }))

  const [assessment, certification] = await Promise.all([
    db.mscsAssessment.findFirst({ orderBy: { startedAt: "desc" } }),
    db.mscsCertification.findFirst({ orderBy: { issuedAt: "desc" } }),
  ])

  // Live gate state: derived from the latest certification run (exception-aware engine)
  const gatesPassed: string[] = certification ? (JSON.parse(certification.gatesPassed || "[]") as string[]) : []
  const gates = { A: gatesPassed.includes("A"), B: gatesPassed.includes("B"), C: gatesPassed.includes("C"), D: gatesPassed.includes("D") }

  return ok({
    total: rows.length,
    byApplicability,
    byStatus,
    score: scorePct,
    applicableCount: applicable.length,
    readyCount,
    gates,
    gatesReadiness: {
      description: "Applicable C3/C4 controls not yet at S60+",
      count: criticalBelow.length,
      ids: criticalBelow.slice(0, 60),
    },
    domains,
    assessment: assessment
      ? { ...assessment, declaration: json<Record<string, unknown>>(assessment.declaration, {}), gates: json<Record<string, boolean>>(assessment.gates, {}) }
      : null,
    certification: certification
      ? { ...certification, gatesPassed: json<string[]>(certification.gatesPassed, []), conditions: json<string[]>(certification.conditions, []), riskExceptions: json<string[]>(certification.riskExceptions, []) }
      : null,
  }, requestId)
}
