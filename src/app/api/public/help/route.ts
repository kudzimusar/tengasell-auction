// GET /api/public/help?q&type — published help/seller-doc articles (public, no auth)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

// Public-safe CMS types surfaced in the help centre
const PUBLIC_TYPES = ["HELP", "SELLER_DOC"] as const

export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const sp = req.nextUrl.searchParams
  const q = (sp.get("q") || "").trim()
  const type = sp.get("type") || ""
  const locale = sp.get("locale") === "ja" ? "ja" : "en"

  const where: Record<string, unknown> = { status: "PUBLISHED" }
  if (type && ["HELP", "SELLER_DOC", "ANNOUNCEMENT", "KB", "RUNBOOK"].includes(type)) {
    where.type = type
  } else {
    where.type = { in: [...PUBLIC_TYPES] }
  }
  if (q) {
    where.OR = [{ title: { contains: q } }, { titleJa: { contains: q } }]
  }

  const rows = await db.article.findMany({
    where,
    orderBy: { title: "asc" },
    take: 60,
    select: { slug: true, type: true, title: true, titleJa: true, publishedAt: true, category: true },
  })

  return ok({
    items: rows.map((r) => ({
      slug: r.slug,
      type: r.type,
      title: locale === "ja" && r.titleJa ? r.titleJa : r.title,
      titleEn: r.title,
      titleJa: r.titleJa,
      publishedAt: r.publishedAt,
      category: r.category,
    })),
    total: rows.length,
  }, requestId)
}
