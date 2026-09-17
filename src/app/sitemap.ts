import type { MetadataRoute } from "next";
import { collectionPages, seoLandingPages } from "@/data/seo-landing-pages";
import { getPublishedBlogPosts } from "@/lib/blog";
import { getCategoryTree, getProducts } from "@/lib/products/index";
import { siteUrlBase } from "@/lib/seo/json-ld";
import { isPageEnabled, isSaleEnabled } from "@/lib/settings";

function flattenCategorySlugs(nodes: Awaited<ReturnType<typeof getCategoryTree>>): string[] {
  return nodes.flatMap((node) => [node.slug, ...flattenCategorySlugs(node.children)]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrlBase();
  const now = new Date();
  const [fabricTechEnabled, mixMatchEnabled, saleEnabled, categoryTree] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
    getCategoryTree(),
  ]);

  const staticRoutes = [
    "",
    "/shop",
    "/shop/bespoke",
    "/for-hospitals",
    "/school-uniforms",
    "/kids-wear",
    ...(saleEnabled ? ["/sale"] : []),
    ...(mixMatchEnabled ? ["/mix-and-match"] : []),
    ...(fabricTechEnabled ? ["/fabric-technology"] : []),
    "/bulk-orders",
    "/our-story",
    "/about",
    "/contact",
    "/blog",
    "/collections",
    "/guides",
    "/size-guide",
    "/shipping",
    "/returns",
    "/privacy-policy",
    "/terms",
    "/accessibility",
    "/science-of-the-scrub",
    "/scrubs-for-men",
    "/scrubs-for-women",
    "/custom-embroidered-scrubs",
    "/medical-scrubs",
    "/nurse-uniforms",
  ];

  const categorySlugs = flattenCategorySlugs(categoryTree);
  const posts = await getPublishedBlogPosts();
  const products = await getProducts();

  return [
    ...staticRoutes.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.8,
    })),
    ...categorySlugs.map((slug) => ({
      url: `${base}/category/${slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${base}/products/${product.handle}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.85,
    })),
    ...seoLandingPages.map((page) => ({
      url: `${base}/guides/${page.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...collectionPages.map((collection) => ({
      url: `${base}/collections/${collection.handle}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
