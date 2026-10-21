// src/app/robots.ts — robots.txt (SEO/DEV-014, MSCS 12-e).
// Allow the SPA shell; keep crawlers out of the BFF API surface
// (/api/** carries authenticated data and mutation routes).

import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL ?? "http://localhost:81";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/api/",
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
