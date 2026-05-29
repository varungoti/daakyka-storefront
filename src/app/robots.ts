import type { MetadataRoute } from "next";
import { isIndexingAllowed } from "@/lib/env";
import { siteUrlBase } from "@/lib/seo/json-ld";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrlBase();

  if (!isIndexingAllowed()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/checkout"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
