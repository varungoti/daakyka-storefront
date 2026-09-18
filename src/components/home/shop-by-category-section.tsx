import { placeholderForAspect } from "@/data/media/image-manifest";
import { SectionHeading } from "@/components/ui/section-heading";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export interface ShopByCategoryTile {
  title: string;
  href: string;
  image: string | null;
  cta?: string;
}

const TILE_PLACEHOLDER = placeholderForAspect("portrait");

/**
 * Phase C3: the new store home's "shop by category" tiles — built from
 * the top-level DB category tree (For Hospitals / School Uniforms / Kids
 * Wear) plus an optional Sale tile, instead of the old hardcoded
 * tops/bottoms/sets/bespoke seed categories. `image` (resolved in
 * src/app/page.tsx via getSiteImage's `home.tile.*` manifest slots, see
 * Phase E2) is null until an admin generates or uploads one, in which
 * case a neutral placeholder tile is shown instead of a broken <Image>.
 */
export function ShopByCategorySection({ categories }: { categories: ShopByCategoryTile[] }) {
  if (categories.length === 0) return null;

  return (
    <section className="bg-background py-12 md:py-16">
      <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
        <SectionHeading
          eyebrow="Browse"
          title="Shop by Category"
          description="Everything you need for hospitals, schools, and everyday kids' wear."
        />

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.href}
              href={category.href}
              className="hover:border-brand hover:shadow-sm transition-colors group relative overflow-hidden rounded-3xl border border-border"
            >
              <div className="relative aspect-[4/5] bg-lilac/30">
                <Image
                  src={category.image ?? TILE_PLACEHOLDER}
                  alt={`${category.title} — DAAKYKA Apparels`}
                  fill
                  className="object-cover transition duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <h3 className="font-display text-2xl font-bold text-white">
                    {category.title}
                  </h3>
                  <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/90">
                    {category.cta ?? "Shop Now"}
                    <ArrowRight size={16} />
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
