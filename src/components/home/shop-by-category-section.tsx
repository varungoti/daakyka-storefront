import { categoryMedia, scrubMedia } from "@/data/media/catalog";
import { SectionHeading } from "@/components/ui/section-heading";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const categories = [
  {
    title: "Tops",
    href: "/shop?category=tops",
    image: categoryMedia.tops,
  },
  {
    title: "Bottoms",
    href: "/shop?category=bottoms",
    image: categoryMedia.bottoms,
  },
  {
    title: "Sets",
    href: "/shop?category=sets",
    image: categoryMedia.sets,
  },
  {
    title: "Bespoke",
    href: "/shop/bespoke",
    image: categoryMedia.bespoke,
    cta: "Customize Now",
  },
  {
    title: "Stretch Collection",
    href: "/fabric-technology/4-way-stretch",
    image: scrubMedia.zipLilac,
  },
];

export function ShopByCategorySection() {
  return (
    <section className="bg-white py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading
          eyebrow="Browse"
          title="Shop by Category"
          description="Explore performance-engineered medical apparel by category."
        />

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.title}
              href={category.href}
              className="neon-border-hover group relative overflow-hidden rounded-3xl"
            >
              <div className="relative aspect-[4/5]">
                <Image
                  src={category.image}
                  alt={`${category.title} — DAAKYKA medical scrubs`}
                  fill
                  className="object-cover transition duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 33vw"
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
