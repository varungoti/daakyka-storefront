import { SectionHeading } from "@/components/ui/section-heading";
import type { KidsConceptPreview } from "@/lib/catalog/kids-concept-gallery";
import { publicImageAlt } from "@/lib/media/public-alt";
import Image from "next/image";

/** Clearly labelled previews; these drafts have no product or checkout links. */
export function KidsConceptGallery({ concepts }: { concepts: KidsConceptPreview[] }) {
  if (concepts.length === 0) return null;
  return (
    <section className="bg-background py-12 md:py-16" aria-labelledby="kids-concepts-heading">
      <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
        <div id="kids-concepts-heading">
          <SectionHeading
            eyebrow="Designs in Review"
            title="Upcoming Kids Wear Concepts"
            description="AI-generated design previews. These garments are not available to buy yet; actual sizes, fabric, price and stock are being verified."
            className="mb-8"
          />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {concepts.map((concept) => (
            <article key={concept.slug} className="overflow-hidden rounded-2xl border border-border bg-white">
              <div className="relative aspect-[4/5] bg-alt-surface">
                <Image
                  src={concept.images[0].url}
                  alt={publicImageAlt(concept.images[0].alt, `${concept.name} AI concept front view`)}
                  fill
                  className="object-contain"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  loading="lazy"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 bg-alt-surface">
                {concept.images.slice(1, 3).map((image, index) => (
                  <div key={index} className="relative aspect-[4/3]">
                    <Image
                      src={image.url}
                      alt={publicImageAlt(image.alt, `${concept.name} AI concept ${index === 0 ? "back" : "detail"} view`)}
                      fill
                      className="object-contain"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 12vw"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-violet">Design concept</p>
                <h3 className="mt-1 text-base font-bold text-ink">{concept.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{concept.color}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
