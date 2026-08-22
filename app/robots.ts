import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://dentalflow.co.ke";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Protected application, API routes, and per-invitee invitation
        // links are not content to index - everything else (including
        // /auth/login and /auth/signup) is fine for a crawler to see.
        disallow: ["/admin", "/api", "/invite"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
