import type { Product } from "@/lib/types";

/**
 * F-218: these are rule-of-thumb suggestions computed from each product's
 * rating, badge and review count — NOT from sales or traffic. The admin
 * Intelligence page says so, and the labels below avoid implying otherwise
 * (a "best seller" here only ever meant "featured or highly rated").
 */
export type InsightCategory =
  | "top_rated"
  | "high_rating"
  | "seo_opportunity"
  | "promotion_candidate";

/** Owner-facing labels for the categories above. */
export const INSIGHT_LABELS: Record<InsightCategory, string> = {
  top_rated: "Featured / top rated",
  high_rating: "Strong reviews",
  seo_opportunity: "Needs reviews",
  promotion_candidate: "New arrival",
};

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
        category: "top_rated",
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
    topRated: insights.filter((i) => i.category === "top_rated").length,
    // Products with few reviews. Kept under the old `seoGaps` name because
    // the weekly report and reputation summary already read it.
    seoGaps: insights.filter((i) => i.category === "seo_opportunity").length,
    promotions: insights.filter((i) => i.category === "promotion_candidate").length,
  };
}
