// ── MSCS registry shared helpers: statuses, scoring, certification gate engine ──
// Used by /api/mscs/* routes (this folder is owned by BUILD-D).
import { db } from "@/lib/db"
import { json } from "@/lib/server/api"

export const STATUSES = ["S00", "S10", "S20", "S30", "S40", "S50", "S60", "S70", "S80", "S90"] as const
export const APPLICABILITIES = ["R", "C", "NA", "F"] as const
export const CRITICALITIES = ["C0", "C1", "C2", "C3", "C4"] as const
export const EVIDENCE_CLASSES = ["E1", "E2", "E3", "E4", "E5", "E6"] as const
export const FINDING_CODES = ["F-IMP", "F-EVD", "F-AUTH", "F-ENV", "F-POL", "F-RSK"] as const
export const FINDING_STATUSES = ["OPEN", "ACCEPTED", "CLOSED", "WAIVED"] as const

export function statusNum(s: string): number {
  const n = parseInt(s.slice(1), 10)
  return Number.isFinite(n) ? n : 0
}

export const isReady = (status: string) => statusNum(status) >= 60 // S60 Evidenced or above

// Live computed readiness from the registry (609 rows — cheap enough to scan in JS).
export async function registrySnapshot() {
  const rows = await db.mscsControl.findMany({
    select: { id: true, domain: true, domainName: true, applicability: true, status: true, criticality: true },
  })
  const applicable = rows.filter((c) => c.applicability === "R" || c.applicability === "C")
  const readyCount = applicable.filter((c) => isReady(c.status)).length
  const scorePct = applicable.length === 0 ? 100 : Math.round((readyCount / applicable.length) * 1000) / 10
  const criticalBelow = applicable
    .filter((c) => (c.criticality === "C3" || c.criticality === "C4") && !isReady(c.status))
    .map((c) => c.id)
  return { rows, applicable, readyCount, scorePct, criticalBelow }
}

// Sequential evidence id EV-### (avoid collisions with seeded/created rows)
export async function nextEvidenceId(): Promise<string> {
  const count = await db.mscsEvidence.count()
  for (let i = count + 1; i < count + 50; i++) {
    const id = `EV-${String(i).padStart(3, "0")}`
    const exists = await db.mscsEvidence.findUnique({ where: { id } })
    if (!exists) return id
  }
  return `EV-${Date.now()}`
}

export async function nextCertificationId(): Promise<string> {
  const count = await db.mscsCertification.count()
  for (let i = count + 1; i < count + 50; i++) {
    const id = `MSCS-CERT-${String(i).padStart(3, "0")}`
    const exists = await db.mscsCertification.findUnique({ where: { id } })
    if (!exists) return id
  }
  return `MSCS-CERT-${Date.now()}`
}

// ── THE CERTIFICATION GATE ENGINE (MSCS 1.0 § Certification) ──
// Computed from live data — no hand-typed scores. C is treated as in-scope for gates.
export async function runCertificationGate(actor: { id: string; role: string }) {
  const { applicable, scorePct, criticalBelow } = await registrySnapshot()
  const now = new Date()

  // Gate A — every applicable C3/C4 control is Evidenced (>=S60) OR covered by an ACTIVE, approved,
  // non-expired RiskException (MSCS Template C: approved deviations ride as certification conditions, not blockers)
  const activeEx = await db.riskException.findMany({ where: { status: "ACTIVE" } })
  const coveredByException = new Set<string>()
  for (const e of activeEx) {
    const ids = json(e.controls, [] as string[])
    const okEx = new Date(e.expiry) >= now && !!e.approver && !!e.owner
    if (okEx) for (const c of ids) coveredByException.add(c)
  }
  const gateAUncovered = criticalBelow.filter((c) => !coveredByException.has(c))
  const gateA = gateAUncovered.length === 0
  const gateADetail = {
    passed: gateA,
    failedControls: gateAUncovered.slice(0, 40),
    failedCount: gateAUncovered.length,
    exceptionCovered: criticalBelow.length - gateAUncovered.length,
    description: "All applicable C3/C4 controls >= S60 or covered by approved risk exceptions",
  }

  // Gate B — no ACTIVE C3/C4 risk exception that is expired or lacks owner/approver
  const exceptions = await db.riskException.findMany({ where: { status: "ACTIVE", criticality: { in: ["C3", "C4"] } } })
  const badExceptions = exceptions.filter((e) => new Date(e.expiry) < now || !e.approver || !e.owner)
  const gateB = badExceptions.length === 0
  const gateBDetail = {
    passed: gateB,
    failed: badExceptions.map((e) => e.exceptionId),
    description: "No active C3/C4 risk exception expired or missing owner/approver",
  }

  // Gate C — runtime evidence: >= 20 E3 rows + a BALANCED reconciliation + a PASS restore test
  const [e3Count, balancedRecon, passRestore] = await Promise.all([
    db.mscsEvidence.count({ where: { evidenceClass: "E3" } }),
    db.reconciliationRun.findFirst({ where: { status: "BALANCED" }, orderBy: { ranAt: "desc" } }),
    db.restoreTest.findFirst({ where: { result: "PASS" }, orderBy: { performedAt: "desc" } }),
  ])
  const gateC = e3Count >= 20 && !!balancedRecon && !!passRestore
  const gateCDetail = {
    passed: gateC,
    e3Evidence: e3Count,
    e3Required: 20,
    balancedReconciliation: !!balancedRecon,
    restoreTestPass: !!passRestore,
    description: "Runtime evidence: 20+ E3 records, BALANCED reconciliation, PASS restore test",
  }

  // Gate D — M2 operational readiness: scheduler backups logged + tickets + postmortem + recon runs
  const [backupLog, ticketCount, pmIncident, anyRecon] = await Promise.all([
    db.appLog.findFirst({ where: { source: "scheduler", message: { startsWith: "backup-ok" } }, orderBy: { createdAt: "desc" } }),
    db.ticket.count(),
    db.incident.findFirst({ where: { postmortemRef: { not: null } } }),
    db.reconciliationRun.findFirst(),
  ])
  const gateD = !!backupLog && ticketCount > 0 && !!pmIncident && !!anyRecon
  const gateDDetail = {
    passed: gateD,
    backupEvidence: !!backupLog,
    tickets: ticketCount,
    postmortemIncident: !!pmIncident,
    reconciliationRuns: !!anyRecon,
    description: "M2 ops readiness: scheduled backups, support operating, postmortem, reconciliation",
  }

  // Open F-IMP implementation findings on applicable C3/C4 controls
  const criticalIds = new Set(
    applicable.filter((c) => c.criticality === "C3" || c.criticality === "C4").map((c) => c.id),
  )
  const openImp = await db.mscsFinding.findMany({ where: { code: "F-IMP", status: "OPEN" } })
  const impCritical = openImp.filter((f) => criticalIds.has(f.controlId))

  let disposition: "PASS" | "PASS_WITH_CONDITIONS" | "FAIL"
  if (!gateA || !gateB) disposition = "FAIL"
  else if (scorePct < 90 || !gateC || !gateD || impCritical.length > 0) disposition = "PASS_WITH_CONDITIONS"
  else disposition = "PASS"

  // Conditions — generated from live failures/exceptions/open findings
  const conditions: string[] = []
  const activeExceptions = await db.riskException.findMany({ where: { status: "ACTIVE" }, orderBy: { exceptionId: "asc" } })
  for (const e of activeExceptions) {
    conditions.push(`Active risk exception ${e.exceptionId} (C:${e.criticality}) — ${e.reason}`)
  }
  if (!gateA) conditions.push(`Gate A failed: ${criticalBelow.length} applicable C3/C4 control(s) below S60 (e.g. ${criticalBelow.slice(0, 5).join(", ")})`)
  if (!gateB) conditions.push(`Gate B failed: ${badExceptions.map((e) => e.exceptionId).join(", ")} — expired or unapproved C3/C4 exception(s)`)
  if (!gateC) conditions.push(`Gate C failed: runtime evidence incomplete (E3=${e3Count}/20, reconciliation=${balancedRecon ? "yes" : "no"}, restore test=${passRestore ? "yes" : "no"})`)
  if (!gateD) conditions.push(`Gate D failed: M2 operational readiness incomplete (backups=${backupLog ? "yes" : "no"}, tickets=${ticketCount}, postmortem=${pmIncident ? "yes" : "no"}, recon=${anyRecon ? "yes" : "no"})`)
  if (scorePct < 90) conditions.push(`Weighted score ${scorePct}% is below the M2 profile threshold of 90%`)
  for (const f of impCritical) conditions.push(`Open finding ${f.id} (${f.code}) on critical control ${f.controlId}`)

  const gatesPassed = ([gateA && "A", gateB && "B", gateC && "C", gateD && "D"] as const).filter(Boolean) as string[]
  const reviewAt = new Date(Date.now() + 90 * 24 * 3600 * 1000)

  // Persist: Template D certification record + close out the assessment
  const assessment = await db.mscsAssessment.findFirst({ orderBy: { startedAt: "desc" } })
  const certId = await nextCertificationId()
  const cert = await db.mscsCertification.create({
    data: {
      id: certId,
      assessmentId: assessment?.id ?? "n/a",
      profile: assessment?.profile ?? "M2",
      weightedScore: scorePct,
      gatesPassed: JSON.stringify(gatesPassed),
      conditions: JSON.stringify(conditions),
      riskExceptions: JSON.stringify(activeExceptions.map((e) => e.exceptionId)),
      disposition,
      reviewAt,
      assessmentLead: assessment?.assessmentLead ?? "Compliance",
      independentVerifier: "Z.ai Code (orchestrator)",
      authority: "Tengasell executive",
    },
  })
  if (assessment) {
    await db.mscsAssessment.update({
      where: { id: assessment.id },
      data: {
        score: scorePct,
        gates: JSON.stringify({ A: gateA, B: gateB, C: gateC, D: gateD }),
        status: "COMPLETE",
        completedAt: now,
      },
    })
  }

  return {
    certification: {
      ...cert,
      gatesPassed,
      conditions,
      riskExceptions: json<string[]>(cert.riskExceptions, []),
    },
    score: scorePct,
    applicableCount: applicable.length,
    gates: { A: gateADetail, B: gateBDetail, C: gateCDetail, D: gateDDetail },
    actor,
  }
}
