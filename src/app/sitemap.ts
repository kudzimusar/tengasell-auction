// src/app/sitemap.ts — sitemap.xml (SEO/DEV-014, MSCS 12-e).
//
// Static SPA routes + the 8 policy pages + up to 100 live/ended auction
// item pages fetched from TrailBase at request time (2s budget). Live data
// failing (TrailBase down / cold start) falls back to the static set —
// the sitemap always renders. APP_URL env with the documented dev fallback.
//
// Honest note: the item/policy entries carry #/ fragments (hash-router
// SPA). Crawlers ignore fragments, so they are discovery hints for
// indexers/agents; the crawlable entry points remain "/" itself.

import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL ?? "http://localhost:81";

const POLICY_KEYS = ["tos", "privacy", "aup", "rules", "seller", "refunds", "ip", "accessibility"] as const;

async function liveItemIds(): Promise<number[]> {
  try {
    const res = await fetch(
      "http://127.0.0.1:3001/api/records/v1/auctions?order=-created_at&limit=100",
      { signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: { id: number; status: string }[] };
    return (data.records ?? [])
      .filter((r) => r.status === "live" || r.status === "sold" || r.status === "ended")
      .map((r) => Number(r.id))
      .slice(0, 100);
  } catch {
    return []; // static fallback — never a 500 sitemap
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${APP_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${APP_URL}/#/search`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${APP_URL}/#/sell`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${APP_URL}/#/help`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${APP_URL}/#/developers`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    ...POLICY_KEYS.map((k) => ({
      url: `${APP_URL}/#/policies/${k}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  const ids = await liveItemIds();
  const items: MetadataRoute.Sitemap = ids.map((id) => ({
    url: `${APP_URL}/#/item/${id}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticRoutes, ...items];
}
