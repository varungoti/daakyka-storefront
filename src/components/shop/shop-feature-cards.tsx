import { marketingMedia } from "@/data/media/catalog";
import { MixMatchSection } from "@/components/home/mix-match-section";
import { Button } from "@/components/ui/button";
import { ArrowRight, Crown, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function ShopFeatureCards() {
  return (
    <section className="border-t border-border bg-white py-20">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 lg:grid-cols-2 lg:px-8">
        <FeatureCard
          eyebrow="Fabric Science"
          title="The Science of the Scrub"
          description="Explore layered fabric engineering, performance benefits, and care guidance."
          href="/fabric-technology"
          image={marketingMedia.shopFeatureFabric}
          cta="Explore Fabric Tech"
          icon={<Sparkles className="text-brand" size={20} />}
        />
        <FeatureCard
          eyebrow="Luxury Collection"
          title="Bespoke Collection"
          description="Premium fabrics. Tailored fits. Exclusively for those who expect more."
          href="/shop/bespoke"
          image={marketingMedia.shopFeatureBespoke}
          cta="Explore Bespoke"
          icon={<Crown className="text-brand" size={20} />}
          dark
        />
      </div>
    </section>
  );
}

function FeatureCard({
  eyebrow,
  title,
  description,
  href,
  image,
  cta,
  icon,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  image: string;
  cta: string;
  icon: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <article
      className={`overflow-hidden rounded-[2rem] border ${
        dark ? "border-plum/30 bg-plum text-white" : "border-border bg-lavender/30"
      }`}
    >
      <div className="grid md:grid-cols-2">
        <div className="relative min-h-[240px]">
          <Image src={image} alt={title} fill className="object-cover" sizes="400px" />
        </div>
        <div className="flex flex-col justify-center p-8">
          <div className="mb-3 flex items-center gap-2">
            {icon}
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">
              {eyebrow}
            </p>
          </div>
          <h3 className="font-display text-2xl font-bold">{title}</h3>
          <p className="mt-3 text-sm leading-relaxed opacity-80">{description}</p>
          <Link href={href} className="mt-6">
            <Button variant={dark ? "luxury" : "primary"}>
              {cta}
              <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
      </div>
    </article>
  );
}

export function ShopMixMatchPromo() {
  return <MixMatchSection />;
}
