// GET /api/categories — active categories ordered by sort, with live ACTIVE listing counts
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  try {
    const cats = await db.category.findMany({ where: { active: true }, orderBy: { sort: "asc" } })
    const counts = await db.listing.groupBy({
      by: ["categoryId"],
      where: { status: "ACTIVE" },
      _count: { id: true },
    })
    const countMap = new Map(counts.map(c => [c.categoryId, c._count.id]))
    const items = cats.map(c => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      nameJa: c.nameJa,
      icon: c.icon,
      listingCount: countMap.get(c.id) || 0,
    }))
    return ok({ items }, requestId)
  } catch {
    return fail("Could not load categories", 500, requestId)
  }
}
