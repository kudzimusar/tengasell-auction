// GET /api/public/status — public status page data (current components, history, incidents)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

const COMPONENTS = ["core", "payments", "search", "comms"] as const
const RANK: Record<string, number> = { DOWN: 3, DEGRADED: 2, MAINTENANCE: 2, OPERATIONAL: 1 }

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)

  const [events, incidents] = await Promise.all([
    db.statusEvent.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 200 }),
    db.incident.findMany({
      where: { status: { in: ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"] } },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ])

  // Current status per component = latest event; an event with endedAt means it recovered to OPERATIONAL
  const current: Record<string, { status: string; message: string | null; since: string }> = {}
  for (const component of COMPONENTS) {
    const latest = events.find((e) => e.component === component)
    if (!latest) {
      current[component] = { status: "OPERATIONAL", message: null, since: new Date().toISOString() }
    } else if (latest.endedAt) {
      current[component] = { status: "OPERATIONAL", message: latest.message ? `${latest.message} — resolved` : "Resolved", since: latest.endedAt.toISOString() }
    } else {
      current[component] = { status: latest.status, message: latest.message, since: latest.startedAt.toISOString() }
    }
  }

  const worst = Object.values(current).reduce((acc, c) => Math.max(acc, RANK[c.status] || 1), 1)
  const overall = worst >= 3 ? "DOWN" : worst === 2 ? "DEGRADED" : "OPERATIONAL"
  const maintenance = Object.values(current).some((c) => c.status === "MAINTENANCE")

  const history = events.slice(0, 20).map((e) => ({
    id: e.id,
    component: e.component,
    status: e.status,
    message: e.message,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
  }))

  // Public-safe incident fields only — no commander or internal notification detail
  const publicIncidents = incidents.map((i) => ({
    ref: i.ref,
    severity: i.severity,
    status: i.status,
    title: i.title,
    impact: i.impact,
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    postmortemRef: i.postmortemRef,
  }))

  return ok({
    overall,
    maintenance,
    current,
    history,
    incidents: publicIncidents,
    generatedAt: new Date().toISOString(),
  }, requestId)
}
