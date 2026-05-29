import { Button } from "@/components/ui/button";
import { brand } from "@/data/brand";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  HeartPulse,
  Hotel,
  Shirt,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";

const sectorIcons = {
  Healthcare: HeartPulse,
  "Educational Institutions": GraduationCap,
  "Corporate & Infrastructure": Building2,
  "Facility Management": Building2,
  "Hotels & Hospitality": Hotel,
} as const;

const specIcons = {
  healthcare: HeartPulse,
  school: GraduationCap,
  sports: Trophy,
  corporate: Building2,
  blazer: Shirt,
} as const;

export function BulkOrdersSection() {
  return (
    <section className="bg-white py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Primary CTA — mockup hospital teams strip */}
        <div className="overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-lilac/50 via-white to-lavender/70 p-8 shadow-sm md:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-5">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">
                Hospital & Institutional Teams
              </p>
              <h2 className="font-display text-3xl font-bold leading-tight text-ink md:text-4xl">
                Uniforms & Linens for Pan India
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-muted">
                {brand.legalName} delivers department-wise planning, logo embroidery, color
                standardization, and bulk pricing for hospitals, schools, and corporate teams.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/bulk-orders">
                  <Button size="lg">
                    Request a Quote
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/institutional">
                  <Button variant="outline" size="lg">
                    Institutional Solutions
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard icon={Building2} value="9+" label="Years Manufacturing" />
              <StatCard icon={Users} value="Pan India" label="Delivery & Fulfillment" />
            </div>
          </div>
        </div>

        {/* Specializations — compact mockup-style tiles */}
        <div className="mt-14">
          <div className="mb-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
              Specializing In
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-ink md:text-3xl">
              Institutional Apparel Programs
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {brand.specializations.map((item) => {
              const Icon = specIcons[item.icon as keyof typeof specIcons] ?? Building2;
              return (
                <Link
                  key={item.title}
                  href={item.href}
                  className="neon-border-hover group rounded-2xl border border-border bg-lavender/25 p-5 transition"
                >
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-white">
                    <Icon size={22} />
                  </div>
                  <h4 className="font-display text-sm font-bold text-ink">{item.title}</h4>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Trusted by — client sectors strip */}
        <div className="mt-14 rounded-[2rem] border border-border bg-lavender/30 p-8 md:p-10">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-brand">
            Trusted By Leading Organizations
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {brand.clientSectors.map((sector) => {
              const Icon = sectorIcons[sector.name as keyof typeof sectorIcons] ?? Building2;
              return (
                <article
                  key={sector.name}
                  className="rounded-xl border border-border/80 bg-white p-4 text-center shadow-sm"
                >
                  <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <Icon size={18} />
                  </div>
                  <h4 className="font-display text-xs font-bold text-ink">{sector.name}</h4>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{sector.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Building2;
  value: string;
  label: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-6 text-center">
      <Icon className="mx-auto mb-3 text-brand" size={28} />
      <p className="font-display text-2xl font-bold text-brand">{value}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{label}</p>
    </div>
  );
}
