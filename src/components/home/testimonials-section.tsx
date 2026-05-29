"use client";

import { SectionHeading } from "@/components/ui/section-heading";
import { StarRating } from "@/components/ui/star-rating";
import type { Testimonial } from "@/lib/types";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface TestimonialsSectionProps {
  testimonials: Testimonial[];
}

export function TestimonialsSection({ testimonials }: TestimonialsSectionProps) {
  const [index, setIndex] = useState(0);
  const featured = testimonials.find((t) => t.id) ?? testimonials[0];
  const current = testimonials[index] ?? testimonials[0];

  if (!featured || !current) return null;

  const navigate = (direction: "prev" | "next") => {
    setIndex((prev) => {
      if (direction === "prev") return prev === 0 ? testimonials.length - 1 : prev - 1;
      return prev === testimonials.length - 1 ? 0 : prev + 1;
    });
  };

  return (
    <section className="bg-lavender/30 py-20">
      <div className="mx-auto max-w-7xl space-y-16 px-4 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
          <SectionHeading
            eyebrow="Social Proof"
            title="Loved By Healthcare Heroes"
            description="Trusted by doctors, nurses, and healthcare teams across the world."
          />

          <article className="relative rounded-[2rem] border border-border bg-white p-8 shadow-lg md:p-10">
            <Quote className="text-brand/30" size={48} />
            <p className="mt-4 text-lg leading-relaxed text-ink md:text-xl">
              &ldquo;{featured.quote}&rdquo;
            </p>
            <div className="mt-8 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative h-14 w-14 overflow-hidden rounded-full ring-2 ring-brand/20">
                  <Image src={featured.avatar} alt={featured.name} fill className="object-cover" sizes="56px" />
                </div>
                <div>
                  <p className="font-display font-bold text-ink">{featured.name}</p>
                  <p className="text-sm text-muted">{featured.title}</p>
                </div>
              </div>
              <StarRating rating={featured.rating} />
            </div>
          </article>
        </div>

        <div>
          <SectionHeading eyebrow="Community" title="Voices of Our Community" className="mb-8" />
          <div className="relative rounded-[2rem] border border-border bg-white p-8 shadow-sm">
            <p className="text-lg leading-relaxed text-ink md:text-xl">&ldquo;{current.quote}&rdquo;</p>
            <div className="mt-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 overflow-hidden rounded-full">
                  <Image src={current.avatar} alt={current.name} fill className="object-cover" sizes="44px" />
                </div>
                <div>
                  <p className="font-semibold text-ink">{current.name}</p>
                  <p className="text-sm text-muted">{current.title}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate("prev")}
                  className="rounded-full border border-border p-2 hover:border-brand hover:text-brand"
                  aria-label="Previous"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => navigate("next")}
                  className="rounded-full border border-border p-2 hover:border-brand hover:text-brand"
                  aria-label="Next"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {testimonials.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    index === i ? "border-brand bg-brand/5" : "border-border hover:border-brand/30"
                  }`}
                >
                  <StarRating rating={t.rating} size="sm" />
                  <p className="mt-2 line-clamp-2 text-xs text-muted">{t.quote}</p>
                  <p className="mt-2 text-xs font-semibold text-ink">{t.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
