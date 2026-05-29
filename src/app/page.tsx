import { BestSellersSection } from "@/components/home/best-sellers-section";
import { BespokeSection } from "@/components/home/bespoke-section";
import { BulkOrdersSection } from "@/components/home/bulk-orders-section";
import { HeroFeatureStrip, HeroSection } from "@/components/home/hero-section";
import { InsightsStrip } from "@/components/home/insights-strip";
import { JournalSection } from "@/components/home/journal-section";
import { OffersStrip } from "@/components/home/offers-strip";
import { ScienceSection } from "@/components/home/science-section";
import { ShopByCategorySection } from "@/components/home/shop-by-category-section";
import { TestimonialsSection } from "@/components/home/testimonials-section";
import { TrustBar } from "@/components/layout/trust-bar";
import { getHeroContent, getTrustStatsContent } from "@/lib/homepage";
import { getBestSellers } from "@/lib/products";
import { getTestimonials } from "@/lib/testimonials";
import dynamic from "next/dynamic";

const MixMatchSection = dynamic(
  () =>
    import("@/components/home/mix-match-section").then((mod) => ({
      default: mod.MixMatchSection,
    })),
  { loading: () => <div className="min-h-[360px]" aria-hidden /> },
);

export default async function HomePage() {
  const [bestSellers, heroContent, trustStats, testimonials] = await Promise.all([
    getBestSellers(),
    getHeroContent(),
    getTrustStatsContent(),
    getTestimonials(),
  ]);

  return (
    <>
      <HeroSection content={heroContent} trustStats={trustStats.stats} />
      <HeroFeatureStrip />
      <OffersStrip />
      <BestSellersSection products={bestSellers} />
      <ShopByCategorySection />
      <MixMatchSection />
      <BespokeSection />
      <ScienceSection />
      <TestimonialsSection testimonials={testimonials} />
      <InsightsStrip />
      <BulkOrdersSection />
      <JournalSection />
      <TrustBar />
    </>
  );
}
