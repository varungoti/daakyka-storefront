"use client";

import { ProductCard } from "@/components/ui/product-card";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Product } from "@/lib/types";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

interface BestSellersSectionProps {
  products: Product[];
}

export function BestSellersSection({ products }: BestSellersSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = direction === "left" ? -320 : 320;
    scrollRef.current.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <section className="bg-lavender/30 py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            eyebrow="Curated For You"
            title="Shop Best Sellers"
            description="Our most-loved scrubs, chosen by healthcare professionals worldwide."
          />
          <div className="flex items-center gap-3">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
            >
              View All Products
              <ArrowRight size={16} />
            </Link>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => scroll("left")}
                className="rounded-full border border-border p-2 hover:border-brand hover:text-brand"
                aria-label="Scroll left"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => scroll("right")}
                className="rounded-full border border-border p-2 hover:border-brand hover:text-brand"
                aria-label="Scroll right"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((product) => (
            <div key={product.id} className="w-[280px] shrink-0 snap-start md:w-[300px]">
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
