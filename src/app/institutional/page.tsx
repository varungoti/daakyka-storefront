import { ClientLogosStrip } from "@/components/brand/client-logos-strip";
import { ContactForm } from "@/components/contact/contact-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { brand } from "@/data/brand";
import { daakykaMedia } from "@/data/media/catalog";
import {
  Building2,
  GraduationCap,
  HeartPulse,
  Shirt,
  Trophy,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Institutional Solutions",
  description: `${brand.name} — hospital linens, scrubs, school uniforms, sports kits, corporate wear, and made-to-measure blazers. ${brand.location.serviceArea}.`,
};

const iconMap = {
  healthcare: HeartPulse,
  school: GraduationCap,
  sports: Trophy,
  corporate: Building2,
  blazer: Shirt,
} as const;

export default function InstitutionalPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-lavender/40 to-white py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 lg:grid-cols-2 lg:px-8">
          <div>
            <SectionHeading
              eyebrow="Institutional Apparel"
              title="Uniforms & Linens for Every Sector"
              description={`${brand.legalName} delivers design-led, quality-controlled apparel for healthcare, education, corporate, FMS, and hospitality — with ${brand.location.serviceArea} fulfillment.`}
            />
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-border shadow-lg">
            <Image
              src={daakykaMedia.productDesigns}
              alt="Hospital uniforms, scrubs, and institutional apparel by DAAKYKA"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />
          </div>
        </div>
      </section>

      <section className="pb-12">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="grid gap-6 md:grid-cols-2">
            {brand.specializations.map((item) => {
              const Icon = iconMap[item.icon as keyof typeof iconMap] ?? Building2;
              return (
                <article
                  key={item.title}
                  className="rounded-[2rem] border border-border bg-white p-8 shadow-sm"
                >
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                    <Icon size={28} />
                  </div>
                  <h2 className="font-display text-xl font-bold text-ink">{item.title}</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{item.description}</p>
                  <Link
                    href={item.href}
                    className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline"
                  >
                    Explore options →
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <ClientLogosStrip
        title="Institutional Partners"
        description="Hospitals, schools, corporates, and hospitality brands that trust Babaji Enterprises."
      />

      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <SectionHeading
                eyebrow="Start a Project"
                title="Request an Institutional Quote"
                description="Share your organization details, staff count, and product requirements. Our team will prepare a tailored proposal."
              />
              <ul className="mt-6 space-y-3 text-sm text-muted">
                {brand.valueProps.slice(0, 4).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/bulk-orders"
                className="mt-6 inline-flex rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
              >
                Detailed Bulk Order Form →
              </Link>
            </div>
            <ContactForm defaultType="INSTITUTIONAL" />
          </div>
        </div>
      </section>
    </>
  );
}
