import { marketingMedia } from "@/data/media/catalog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Crown, Gem, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const features = [
  { icon: Gem, label: "Premium Fabrics" },
  { icon: Crown, label: "Limited Edition Styles" },
  { icon: Star, label: "Tailored for Excellence" },
  { icon: Sparkles, label: "Personalized Experience" },
];

export function BespokeSection() {
  return (
    <section className="relative overflow-hidden py-0">
      <div className="fabric-wave absolute inset-0" />
      <div className="absolute inset-0 opacity-30">
        <div className="animate-wave absolute -left-1/4 top-0 h-full w-[200%] bg-[repeating-linear-gradient(120deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.08)_2px,transparent_2px,transparent_80px)]" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 lg:grid-cols-2 lg:px-8 lg:py-28">
        <div className="animate-fade-in-left relative">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl">
            <Image
              src={marketingMedia.bespokeFeature}
              alt="DAAKYKA Bespoke collection"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-plum/80 via-transparent to-transparent" />
          </div>
          <div className="absolute -right-4 -top-4 flex h-24 w-24 items-center justify-center rounded-full border-4 border-amber-300/80 bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 shadow-[0_8px_32px_rgba(251,191,36,0.45)] md:-right-6 md:-top-6 md:h-28 md:w-28">
            <span className="font-display text-3xl font-extrabold text-amber-950 md:text-4xl">
              D
            </span>
          </div>
        </div>

        <div className="animate-fade-in-right space-y-8 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-electric-violet">
              DAAKYKA Bespoke
            </p>
            <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight md:text-5xl">
              Luxury in Every Stitch
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-white/75">
              Exclusively crafted for those who value refinement, performance and
              prestige. Premium fabrics, limited editions, and personalized
              experiences for discerning healthcare professionals.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {features.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm"
              >
                <Icon className="text-electric-violet" size={20} />
                <span className="text-sm font-semibold">{label}</span>
              </div>
            ))}
          </div>

          <Link href="/shop/bespoke">
            <Button variant="luxury" size="lg">
              Explore Bespoke Collection
              <ArrowRight size={18} />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
