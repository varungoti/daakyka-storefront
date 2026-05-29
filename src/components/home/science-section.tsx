import { SectionHeading } from "@/components/ui/section-heading";
import { ArrowRight, Droplets, Leaf, Move, Shield } from "lucide-react";
import Link from "next/link";

const scienceCards = [
  {
    icon: Move,
    title: "4-Way Stretch",
    description:
      "Moves with you in every direction for ultimate comfort during long shifts.",
    href: "/fabric-technology/4-way-stretch",
  },
  {
    icon: Droplets,
    title: "Liquid Repellent",
    description:
      "Advanced technology that keeps you dry and confident all day.",
    href: "/fabric-technology/liquid-repellent",
  },
  {
    icon: Shield,
    title: "Anti Microbial",
    description:
      "Built-in protection that inhibits odor causing bacteria.",
    href: "/fabric-technology/anti-microbial",
  },
  {
    icon: Leaf,
    title: "EcoFlex™ Sustainable",
    description:
      "Sustainable fabrics for a better you and a better planet.",
    href: "/fabric-technology/eco-fabric",
  },
];

export function ScienceSection() {
  return (
    <section className="bg-lavender/30 py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading
          eyebrow="Fabric Technology"
          title="The Science Behind The Scrub"
          description="Engineered performance fabrics designed for the demands of modern healthcare."
          align="center"
          className="mb-12"
        />

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {scienceCards.map((card) => (
            <article
              key={card.title}
              className="neon-border-hover rounded-3xl border border-border bg-white p-6"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-lilac/60">
                <card.icon className="text-brand" size={26} />
              </div>
              <h3 className="font-display text-xl font-bold text-ink">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {card.description}
              </p>
              <Link
                href={card.href}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                Learn More
                <ArrowRight size={16} />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
