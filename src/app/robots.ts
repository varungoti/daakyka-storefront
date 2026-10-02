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
        // F-045: /account was missing here, so a crawler could index the
        // login/orders/addresses pages once indexing goes live (production
        // is noindex today, which is what masked this). /order/<number> is
        // the per-customer order confirmation — noindex on the page too.
        disallow: ["/admin/", "/api/", "/checkout", "/account", "/order/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
