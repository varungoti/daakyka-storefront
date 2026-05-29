import { ProductCard } from "@/components/ui/product-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { getFabricTechPage } from "@/data/fabric-tech";
import type { Product } from "@/lib/types";
import { getProducts } from "@/lib/products";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

interface FabricTechDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const { fabricTechPages } = await import("@/data/fabric-tech");
  return fabricTechPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: FabricTechDetailPageProps) {
  const { slug } = await params;
  const page = getFabricTechPage(slug);
  if (!page) return { title: "Fabric Technology" };
  return {
    title: page.title,
    description: page.description,
  };
}

export default async function FabricTechDetailPage({
  params,
}: FabricTechDetailPageProps) {
  const { slug } = await params;
  const page = getFabricTechPage(slug);

  if (!page) {
    notFound();
  }

  const allProducts = await getProducts();
  const techKeyMap: Record<string, string> = {
    "4-way-stretch": "4-way-stretch",
    "2-way-stretch": "2-way-stretch",
    "liquid-repellent": "liquid-repellent",
    "anti-microbial": "anti-microbial",
    "eco-fabric": "eco-flex",
    "moisture-wicking": "moisture-wicking",
  };

  const techKey = techKeyMap[page.slug];
  const relatedProducts = allProducts
    .filter((product) => product.fabricTech.includes(techKey as Product["fabricTech"][number]))
    .slice(0, 4);

  const matchedProducts =
    relatedProducts.length > 0
      ? relatedProducts
      : allProducts.slice(0, 4);

  return (
    <>
      <section className="border-b border-border bg-lavender/30 py-6">
        <div className="mx-auto max-w-7xl px-4 text-sm text-muted lg:px-8">
          <Link href="/" className="hover:text-brand">
            Home
          </Link>
          <span className="mx-2">›</span>
          <Link href="/fabric-technology" className="hover:text-brand">
            Fabric Technology
          </Link>
          <span className="mx-2">›</span>
          <span className="font-semibold text-ink">{page.title}</span>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <Link
            href="/fabric-technology"
            className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
          >
            <ArrowLeft size={16} />
            Back to Fabric Tech
          </Link>

          <SectionHeading
            eyebrow={page.eyebrow}
            title={page.title}
            description={page.description}
          />

          <div className="mt-10 space-y-8">
            <TechBlock title="What It Is" content={page.definition} />
            <TechBlock title="How It Works" content={page.howItWorks} />
            <TechBlock title="Why Healthcare Teams Need It" content={page.whyItMatters} />

            <div className="rounded-3xl border border-border bg-white p-8">
              <h3 className="font-display text-xl font-bold text-ink">Care Tips</h3>
              <ul className="mt-4 space-y-2">
                {page.careTips.map((tip) => (
                  <li key={tip} className="text-sm leading-relaxed text-muted">
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-border bg-lavender/30 p-8">
              <h3 className="font-display text-xl font-bold text-ink">FAQ</h3>
              <div className="mt-6 space-y-6">
                {page.faqs.map((faq) => (
                  <div key={faq.question}>
                    <p className="font-semibold text-ink">{faq.question}</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {faq.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <h2 className="mb-8 font-display text-2xl font-bold text-ink">
            Shop {page.title} Products
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {matchedProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function TechBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-3xl border border-border bg-white p-8">
      <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
      <p className="mt-3 leading-relaxed text-muted">{content}</p>
    </div>
  );
}
