// GET /api/public/policies?key — published policy register (public); acceptance summary when signed in
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, json } from "@/lib/server/api"
import { getSession } from "@/lib/server/auth-core"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const sp = req.nextUrl.searchParams
  const key = sp.get("key") || ""

  // Acceptance summary is optional — only populated for signed-in users
  const session = await getSession()
  const meId = session?.user?.id || null

  if (key) {
    const policy = await db.policy.findUnique({ where: { key } })
    if (!policy || policy.status !== "PUBLISHED") return fail("Policy not found", 404, requestId)

    let acceptance: { accepted: boolean; acceptedAt: string | null; version: number | null } | null = null
    if (meId) {
      const rec = await db.policyAcceptance.findFirst({
        where: { policyKey: key, userId: meId, version: { gte: policy.version } },
        orderBy: { acceptedAt: "desc" },
      })
      acceptance = rec
        ? { accepted: true, acceptedAt: rec.acceptedAt.toISOString(), version: rec.version }
        : { accepted: false, acceptedAt: null, version: null }
    }

    return ok({
      policy: {
        key: policy.key,
        title: policy.title,
        version: policy.version,
        status: policy.status,
        body: policy.body,
        effectiveAt: policy.effectiveAt,
        updatedAt: policy.updatedAt,
        acceptanceRequired: policy.acceptanceRequired,
        jurisdictions: json<string[]>(policy.jurisdictions, ["ZW"]),
        ownerRole: policy.ownerRole,
      },
      acceptance,
    }, requestId)
  }

  const rows = await db.policy.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { key: "asc" },
  })

  let myAcceptances: Record<string, { acceptedAt: string; version: number }> = {}
  if (meId) {
    const recs = await db.policyAcceptance.findMany({ where: { userId: meId } })
    myAcceptances = Object.fromEntries(
      recs.map((r) => [r.policyKey, { acceptedAt: r.acceptedAt.toISOString(), version: r.version }]),
    )
  }

  return ok({
    items: rows.map((p) => ({
      key: p.key,
      title: p.title,
      version: p.version,
      effectiveAt: p.effectiveAt,
      acceptanceRequired: p.acceptanceRequired,
      jurisdictions: json<string[]>(p.jurisdictions, ["ZW"]),
    })),
    total: rows.length,
    myAcceptances,
  }, requestId)
}
