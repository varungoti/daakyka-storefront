import { ClientLogosStrip } from "@/components/brand/client-logos-strip";
import { SectionHeading } from "@/components/ui/section-heading";
import { daakykaMedia } from "@/data/media/catalog";
import { brand } from "@/data/brand";
import { Award, CheckCircle2, MapPin, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Us",
  description: `${brand.name} by ${brand.legalName} — ${brand.tagline}. ${brand.subtagline}.`,
};

export default function AboutPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-lavender/40 to-white py-20">
        <div className="mx-auto max-w-4xl px-4 text-center lg:px-8">
          <SectionHeading
            eyebrow="Our Story"
            title={`${brand.tagline}. ${brand.subtagline}.`}
            description={brand.description}
            align="center"
          />
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm text-muted">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2">
              <MapPin size={16} className="text-brand" />
              {brand.location.city}, {brand.location.state}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2">
              <Award size={16} className="text-brand" />
              {brand.yearsInBusiness}+ Years in Manufacturing
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2">
              <Sparkles size={16} className="text-brand" />
              {brand.location.serviceArea} Service
            </span>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <SectionHeading
            eyebrow="Leadership"
            title="Meet the Founders"
            description="Production excellence meets international design expertise."
            align="center"
          />
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {(
              [
                { ...brand.founders.kamal, image: daakykaMedia.founders.kamal },
                { ...brand.founders.dianeshree, image: daakykaMedia.founders.dianeshree },
              ] as const
            ).map((founder) => (
              <article
                key={founder.name}
                className="overflow-hidden rounded-[2rem] border border-border bg-white shadow-sm"
              >
                <div className="relative aspect-[16/10] bg-lilac/20">
                  <Image
                    src={founder.image}
                    alt={founder.name}
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                </div>
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
        </div>
      </section>

      <section className="border-y border-border bg-lavender/30 py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
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
                className="flex items-start gap-3 rounded-2xl border border-border bg-white p-5 text-sm text-muted"
              >
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-trust" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ClientLogosStrip />

      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-border">
              <Image
                src={daakykaMedia.productDesigns}
                alt="DAAKYKA uniform and scrub manufacturing"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div>
              <SectionHeading
                eyebrow="Our Process"
                title="From Concept to Delivery"
                description="A meticulous workflow designed for healthcare, education, and corporate clients."
              />
              <ol className="mt-8 space-y-4">
                {brand.processSteps.map((step, index) => (
                  <li
                    key={step}
                    className="flex items-start gap-4 rounded-2xl border border-border bg-white p-5"
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
              href="/institutional"
              className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-violet"
            >
              Institutional Solutions
            </Link>
            <Link
              href="/contact"
              className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
            >
              Get in Touch
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
