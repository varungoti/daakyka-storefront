import { BespokeSection } from "@/components/home/bespoke-section";
import { HeroFeatureStrip } from "@/components/home/hero-section";
import { InsightsStrip } from "@/components/home/insights-strip";
import { JournalSection } from "@/components/home/journal-section";
import { ScienceSection } from "@/components/home/science-section";
import { Button } from "@/components/ui/button";
import { PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { brand } from "@/data/brand";
import { isPageEnabled } from "@/lib/settings";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";

const MixMatchSection = dynamic(
  () =>
    import("@/components/home/mix-match-section").then((mod) => ({
      default: mod.MixMatchSection,
    })),
  { loading: () => <div className="min-h-[360px]" aria-hidden /> },
);

export const metadata: Metadata = {
  title: "Our Story",
  description: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.description}`,
};

/**
 * Phase C3: the former homepage's brand-story content, moved here now
 * that `/` is the product-first store home. Hero and Testimonials are
 * intentionally NOT repeated here — they already appear on the new home
 * — so this page only carries what's unique to "about the brand and our
 * craft": fabric feature highlights, the fabric-tech science cards
 * (gated), Mix & Match (gated), the Bespoke collection, and the
 * journal/insights strip.
 */
export default async function OurStoryPage() {
  const [fabricTechEnabled, mixMatchEnabled] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
  ]);

  return (
    <>
      <PageHeroBand innerClassName="max-w-3xl text-center">
        <SectionHeading
          eyebrow="Our Story"
          title={`${brand.tagline}. ${brand.subtagline}.`}
          description={brand.description}
          align="center"
          titleAs="h1"
        />
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/about">
            <Button size="lg">
              Meet the Founders
              <ArrowRight size={18} />
            </Button>
          </Link>
          <Link href="/shop">
            <Button variant="outline" size="lg">
              Shop Now
            </Button>
          </Link>
        </div>
      </PageHeroBand>

      <HeroFeatureStrip />
      <ScienceSection fabricTechEnabled={fabricTechEnabled} />
      {mixMatchEnabled ? <MixMatchSection /> : null}
      <BespokeSection />
      <InsightsStrip fabricTechEnabled={fabricTechEnabled} />
      <JournalSection />
    </>
  );
}
