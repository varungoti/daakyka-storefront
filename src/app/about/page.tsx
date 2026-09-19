import { ClientLogosStrip } from "@/components/brand/client-logos-strip";
import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { brand } from "@/data/brand";
import { getSiteImages } from "@/lib/media/get-site-image";
import { canonicalPath } from "@/lib/seo/canonical";
import { Award, CheckCircle2, MapPin, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Us",
  description: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.subtagline}.`,
  alternates: { canonical: canonicalPath("/about") },
};

/** First letter of each word in a name, e.g. "Kamal Agarwal" -> "KA" — used
 * for the founder monogram fallback when no portrait has been uploaded yet. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const ABOUT_IMAGE_SLOTS = [
  "about.hero",
  "about.founder.kamal",
  "about.founder.dianeshree",
  "about.process",
] as const;

export default async function AboutPage() {
  const images = await getSiteImages(ABOUT_IMAGE_SLOTS);
  const heroImage = images["about.hero"];
  const processImage = images["about.process"];
  const founders = [
    { ...brand.founders.kamal, image: images["about.founder.kamal"] },
    { ...brand.founders.dianeshree, image: images["about.founder.dianeshree"] },
  ] as const;

  return (
    <>
      <PageHeroBand innerClassName="max-w-4xl text-center" image={heroImage}>
        <SectionHeading
          eyebrow="Our Story"
          title={`${brand.tagline}. ${brand.subtagline}.`}
          description={brand.description}
          align="center"
        />
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2">
            <MapPin size={16} className="text-brand" />
            {brand.location.city}, {brand.location.state}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2">
            <Award size={16} className="text-brand" />
            {brand.yearsInBusiness}+ Years in Manufacturing
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2">
            <Sparkles size={16} className="text-brand" />
            {brand.location.serviceArea} Service
          </span>
        </div>
      </PageHeroBand>

      <PageContentSection>
        <SectionHeading
          eyebrow="Leadership"
          title="Meet the Founders"
          description="Production excellence meets international design expertise."
          align="center"
        />
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {founders.map((founder) => (
            <article
              key={founder.name}
              className="overflow-hidden rounded-[2rem] border border-border bg-surface shadow-sm"
            >
              {founder.image ? (
                <div className="relative aspect-[16/10] bg-lilac/20">
                  <Image
                    src={founder.image.url}
                    alt={founder.image.alt || founder.name}
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                </div>
              ) : (
                // No portrait uploaded yet — a monogram stands in rather
                // than an empty/broken image box or an AI-faked photo of a
                // real person (see uploadOnly on the about.founder.* slots).
                <div className="flex aspect-[16/10] items-center justify-center bg-lilac/20">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-violet font-display text-2xl font-bold text-white shadow-sm">
                    {initials(founder.name)}
                  </span>
                </div>
              )}
              <div className="p-8">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
                  {founder.role}
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-ink">{founder.name}</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">{founder.bio}</p>
              </div>
            </article>
          ))}
        </div>
      </PageContentSection>

      <PageContentSection variant="alt">
        <SectionHeading
          eyebrow="Why DAAKYKA"
          title="What Sets Us Apart"
          description="From fabric sourcing to final delivery — every step is built for institutional reliability."
          align="center"
        />
        <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brand.valueProps.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-5 text-sm text-muted"
            >
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-trust" />
              {item}
            </li>
          ))}
        </ul>
      </PageContentSection>

      <ClientLogosStrip />

      <PageContentSection>
        <div className={`grid items-center gap-10 ${processImage ? "lg:grid-cols-2" : "mx-auto max-w-2xl"}`}>
          {processImage ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-border">
              <Image
                src={processImage.url}
                alt={processImage.alt || "DAAKYKA uniform and scrub manufacturing"}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
          ) : null}
          <div>
            <SectionHeading
              eyebrow="Our Process"
              title="From Concept to Delivery"
              description="A meticulous workflow designed for healthcare, education, and corporate clients."
              align={processImage ? "left" : "center"}
            />
            <ol className="mt-8 space-y-4">
              {brand.processSteps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-start gap-4 rounded-2xl border border-border bg-surface p-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <p className="pt-2 text-sm text-muted">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            href="/for-hospitals"
            className="rounded-md bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-violet"
          >
            Institutional Solutions
          </Link>
          <Link
            href="/our-story"
            className="rounded-md border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
          >
            Read Our Story
          </Link>
          <Link
            href="/contact"
            className="rounded-md border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
          >
            Get in Touch
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
