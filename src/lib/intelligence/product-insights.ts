import type { Product } from "@/lib/types";

export type InsightCategory =
  | "best_seller"
  | "high_rating"
  | "bundle_candidate"
  | "seo_opportunity"
  | "promotion_candidate";

export interface ProductInsight {
  handle: string;
  name: string;
  category: InsightCategory;
  score: number;
  metric: string;
  recommendation: string;
}

export function buildProductInsights(products: Product[]): ProductInsight[] {
  const insights: ProductInsight[] = [];

  for (const product of products) {
    if (product.badge === "best-seller" || product.rating >= 4.8) {
      insights.push({
        handle: product.handle,
        name: product.name,
        category: "best_seller",
        score: product.rating * 20,
        metric: `${product.rating}★ · ${product.reviewCount} reviews`,
        recommendation: "Feature in homepage carousel and email campaigns.",
      });
    }

    if (product.rating >= 4.5 && product.reviewCount >= 100) {
      insights.push({
        handle: product.handle,
        name: product.name,
        category: "high_rating",
        score: product.rating * 15,
        metric: "Strong social proof",
        recommendation: "Use in testimonial-led WhatsApp nudges.",
      });
    }

    if (product.category === "tops" || product.category === "bottoms") {
      insights.push({
        handle: product.handle,
        name: product.name,
        category: "bundle_candidate",
        score: 72,
        metric: "Mix & match eligible",
        recommendation: "Bundle with complementary top/bottom in offer engine.",
      });
    }

    if (product.reviewCount < 50) {
      insights.push({
        handle: product.handle,
        name: product.name,
        category: "seo_opportunity",
        score: 55,
        metric: "Low review volume",
        recommendation: "Add FAQ block and post-purchase review request journey.",
      });
    }

    if (product.badge === "new") {
      insights.push({
        handle: product.handle,
        name: product.name,
        category: "promotion_candidate",
        score: 68,
        metric: "New arrival",
        recommendation: "Launch welcome-series spotlight within 7 days.",
      });
    }
  }

  return insights.sort((a, b) => b.score - a.score);
}

export function summarizeInsights(insights: ProductInsight[]) {
  return {
    total: insights.length,
    bestSellers: insights.filter((i) => i.category === "best_seller").length,
    bundles: insights.filter((i) => i.category === "bundle_candidate").length,
    seoGaps: insights.filter((i) => i.category === "seo_opportunity").length,
    promotions: insights.filter((i) => i.category === "promotion_candidate").length,
  };
}
