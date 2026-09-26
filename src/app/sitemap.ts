import type { MetadataRoute } from "next";
import { collectionPages, seoLandingPages } from "@/data/seo-landing-pages";
import { getPublishedBlogPosts } from "@/lib/blog";
import { getCategoryTreeStrict, getProductsStrict } from "@/lib/products/index";
import { siteUrlBase } from "@/lib/seo/json-ld";
import { isPageEnabled, isSaleEnabled } from "@/lib/settings";

// release-hardening audit F-046: this is a metadata route with no
// request-time signal (headers/cookies/searchParams) to opt it into
// dynamic rendering, so Next treats it as fully static — rebuilt only when
// a tag it reads is revalidated (getCategoryTreeStrict/getProductsStrict
// bypass the product/category cache tags entirely). Without a `revalidate`
// TTL, a bad snapshot — e.g. one built while the DB was unreachable — can
// only ever be replaced by an unrelated admin catalog save; this bounds
// that to at most an hour even if no such save ever happens.
export const revalidate = 3600;

// F-333: used to just collect slugs and stamp every category with the
// sitemap's own build/regeneration time — flatten {slug, updatedAt} pairs
// instead so each category keeps its own real last-changed time below.
function flattenCategoryNodes(
  nodes: Awaited<ReturnType<typeof getCategoryTreeStrict>>,
): { slug: string; updatedAt: string }[] {
  return nodes.flatMap((node) => [
    { slug: node.slug, updatedAt: node.updatedAt },
    ...flattenCategoryNodes(node.children),
  ]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrlBase();
  const [fabricTechEnabled, mixMatchEnabled, saleEnabled, categoryTree] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
    // release-hardening audit F-046: the plain (non-strict) getCategoryTree/
    // getProducts silently degrade to `[]`/the fake legacy seed catalog on a
    // DB error, which then gets cached as a "successful" sitemap forever
    // (or until an unrelated admin save happens to revalidate the same
    // tags) — that's how production ended up serving a sitemap with zero
    // /category/ URLs and 8 seed-catalog product handles that all 404. The
    // strict variants below read the DB directly and let an error
    // propagate, so a bad build/regeneration fails loudly instead.
    getCategoryTreeStrict(),
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

  const categoryNodes = flattenCategoryNodes(categoryTree);
  const posts = await getPublishedBlogPosts();
  const products = await getProductsStrict();

  return [
    // F-333: these are hardcoded routes (hero copy, static marketing
    // pages) with no real "last changed" timestamp anywhere to read —
    // stamping them with `now` claimed every one of them changed on every
    // deploy, which search engines learn to distrust and then ignore.
    // Omitting `lastModified` (optional on MetadataRoute.Sitemap) is
    // honest about not having one, rather than inventing a value.
    ...staticRoutes.map((path) => ({
      url: `${base}${path}`,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.8,
    })),
    ...categoryNodes.map(({ slug, updatedAt }) => ({
      url: `${base}/category/${slug}`,
      lastModified: updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${base}/products/${product.handle}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.85,
    })),
    // Hardcoded landing-page/collection copy, same reasoning as
    // staticRoutes above — no real updatedAt to report.
    ...seoLandingPages.map((page) => ({
      url: `${base}/guides/${page.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...collectionPages.map((collection) => ({
      url: `${base}/collections/${collection.handle}`,
      changeFrequency: "weekly" as const,
      priority: 0.75,
    })),
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: post.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
