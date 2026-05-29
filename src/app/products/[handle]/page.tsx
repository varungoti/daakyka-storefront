import { ProductCard } from "@/components/ui/product-card";
import { ProductDetail } from "@/components/product/product-detail";
import { ProductViewTracker } from "@/components/product/product-view-tracker";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { getProductByHandle, getProducts } from "@/lib/products";
import { breadcrumbJsonLd, productJsonLd, siteUrlBase } from "@/lib/seo/json-ld";
import Link from "next/link";
import { notFound } from "next/navigation";

interface ProductPageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    return { title: "Product Not Found" };
  }

  return {
    title: product.name,
    description:
      product.description ??
      `${product.name} in ${product.colorName}. Premium medical apparel by DAAKYKA.`,
    openGraph: {
      title: product.name,
      description: product.description,
      images: [product.image],
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    notFound();
  }

  const allProducts = await getProducts();
  const related = allProducts
    .filter((item) => item.category === product.category && item.id !== product.id)
    .slice(0, 4);

  const base = siteUrlBase();

  return (
    <>
      <JsonLdScript data={productJsonLd(product)} />
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: "Home", url: base },
          { name: "Shop", url: `${base}/shop` },
          { name: product.name, url: `${base}/products/${product.handle}` },
        ])}
      />

      <section className="border-b border-border bg-lavender/20 py-6">
        <div className="mx-auto max-w-7xl px-4 text-sm text-muted lg:px-8">
          <Link href="/" className="hover:text-brand">
            Home
          </Link>
          <span className="mx-2">›</span>
          <Link href="/shop" className="hover:text-brand">
            Shop
          </Link>
          <span className="mx-2">›</span>
          <span className="font-semibold text-ink">{product.name}</span>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <ProductViewTracker handle={product.handle} name={product.name} />
          <ProductDetail product={product} />
        </div>
      </section>

      {related.length > 0 && (
        <section className="border-t border-border bg-lavender/20 py-16">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <h2 className="mb-8 font-display text-2xl font-bold text-ink">
              You May Also Like
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
