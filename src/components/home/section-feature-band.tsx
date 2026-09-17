import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/ui/product-card";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Product } from "@/lib/types";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Phase C3 new home: a "feature band" for one top-level section (For
 * Hospitals, School Uniforms) — a short intro, a handful of its
 * products, and a bulk-order CTA. Used twice on the store home with
 * different copy/products/hrefs.
 */
export function SectionFeatureBand({
  icon: Icon,
  eyebrow,
  title,
  description,
  products,
  browseHref,
  browseLabel,
  variant = "default",
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  products: Product[];
  browseHref: string;
  browseLabel: string;
  variant?: "default" | "alt";
}) {
  if (products.length === 0) return null;

  return (
    <section className={variant === "alt" ? "bg-alt-surface py-12 md:py-16" : "bg-background py-12 md:py-16"}>
      <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Icon size={24} />
            </div>
            <SectionHeading eyebrow={eyebrow} title={title} description={description} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={browseHref}>
              <Button variant="outline">
                {browseLabel}
                <ArrowRight size={16} />
              </Button>
            </Link>
            <Link href="/bulk-orders">
              <Button>Request Bulk Quote</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {products.slice(0, 4).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
