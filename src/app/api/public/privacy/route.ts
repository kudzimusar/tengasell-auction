// GET /api/public/privacy — public privacy centre data: data inventory + processors (non-sensitive metadata only)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)

  const [inventory, processors] = await Promise.all([
    db.dataInventory.findMany({ orderBy: { asset: "asc" } }),
    db.processor.findMany({ orderBy: { name: "asc" } }),
  ])

  return ok({
    inventory: inventory.map((d) => ({
      id: d.id,
      asset: d.asset,
      category: d.category,
      purpose: d.purpose,
      legalBasis: d.legalBasis,
      retention: d.retention,
      residency: d.residency,
    })),
    processors: processors.map((p) => ({
      id: p.id,
      name: p.name,
      purpose: p.purpose,
      country: p.country,
      kind: p.kind,
      dpiaDone: p.dpiaDone,
    })),
  }, requestId)
}
