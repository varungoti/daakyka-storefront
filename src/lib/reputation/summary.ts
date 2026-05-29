import { db } from "@/lib/db";
import { buildProductInsights } from "@/lib/intelligence/product-insights";
import { getProducts } from "@/lib/products";

export async function getReputationSummary() {
  const [testimonials, products] = await Promise.all([
    db.testimonialRecord.findMany({
      where: { active: true },
      select: { rating: true, featured: true },
    }),
    getProducts(),
  ]);

  const insights = buildProductInsights(products);
  const lowReviewProducts = insights
    .filter((item) => item.category === "seo_opportunity")
    .slice(0, 6);
  const topRated = products
    .filter((product) => product.rating >= 4.5 && product.reviewCount >= 50)
    .sort((a, b) => b.reviewCount - a.reviewCount)
    .slice(0, 5);

  const avgTestimonialRating =
    testimonials.length > 0
      ? testimonials.reduce((sum, item) => sum + item.rating, 0) / testimonials.length
      : 0;

  const avgProductRating =
    products.length > 0
      ? products.reduce((sum, product) => sum + product.rating, 0) / products.length
      : 0;

  return {
    activeTestimonials: testimonials.length,
    featuredTestimonials: testimonials.filter((item) => item.featured).length,
    avgTestimonialRating,
    avgProductRating,
    topRated,
    lowReviewProducts,
    totalProductReviews: products.reduce((sum, product) => sum + product.reviewCount, 0),
  };
}
