// GET /api/public/help/[slug] — published article body + related (public, no auth)
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom } from "@/lib/server/api"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { requestId } = ctxFrom(req)
  const { slug } = await params
  const locale = req.nextUrl.searchParams.get("locale") === "ja" ? "ja" : "en"

  const article = await db.article.findUnique({ where: { slug } })
  if (!article || article.status !== "PUBLISHED") {
    return fail("Article not found", 404, requestId)
  }

  const related = await db.article.findMany({
    where: { status: "PUBLISHED", type: article.type, slug: { not: article.slug } },
    orderBy: { title: "asc" },
    take: 4,
    select: { slug: true, type: true, title: true, titleJa: true },
  })

  return ok({
    article: {
      slug: article.slug,
      type: article.type,
      title: locale === "ja" && article.titleJa ? article.titleJa : article.title,
      titleEn: article.title,
      titleJa: article.titleJa,
      body: locale === "ja" && article.bodyJa ? article.bodyJa : article.body,
      bodySource: article.body,
      publishedAt: article.publishedAt,
      version: article.version,
      category: article.category,
    },
    related: related.map((r) => ({
      slug: r.slug,
      type: r.type,
      title: locale === "ja" && r.titleJa ? r.titleJa : r.title,
    })),
  }, requestId)
}
