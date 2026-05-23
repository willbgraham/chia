import type { MetadataRoute } from "next";

// Authoritative robots.txt. Allows all public marketing pages,
// disallows internal surfaces:
//
//   /admin/*    — admin dashboard, requires auth anyway
//   /account/*  — magic-link student dashboards (already noindex'd in
//                 the page metadata, but explicit is better)
//   /api/*      — every API route, including webhooks
//   /c/*        — short-URL redirects (each maps 1:1 to an /account
//                 link; no SEO value in crawling those)
//
// Anything else is fair game for the crawler.

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/account/", "/api/", "/c/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
