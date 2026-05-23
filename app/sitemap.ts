import type { MetadataRoute } from "next";

// Sitemap for crawlers. Lists the four public, indexable pages so
// Google/Bing can discover non-linked routes (/support, /privacy) and
// schedule crawls based on changeFrequency hints.
//
// Internal surfaces (/admin, /account, /api, /c) are deliberately
// omitted — and additionally blocked at the robots.txt level.

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/upgrade`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/support`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
