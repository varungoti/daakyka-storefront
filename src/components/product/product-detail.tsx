"use client";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { StarRating } from "@/components/ui/star-rating";
import { useCurrency } from "@/context/currency-provider";
import type { Product } from "@/lib/types";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

interface ProductDetailProps {
  product: Product;
}

export function ProductDetail({ product }: ProductDetailProps) {
  const { formatPrice } = useCurrency();
  const gallery = product.images?.length ? product.images : [product.image];
  const [activeImage, setActiveImage] = useState(gallery[0]);
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.defaultVariantId ?? product.variants?.[0]?.id ?? "",
  );
  const [selectedSize, setSelectedSize] = useState(product.sizes[0] ?? "M");
  const [selectedColor, setSelectedColor] = useState(product.colorName);

  const selectedVariant = useMemo(() => {
    if (!product.variants?.length) return undefined;

    const bySize = product.variants.find((variant) =>
      variant.selectedOptions.some(
        (option) =>
          option.name.toLowerCase().includes("size") &&
          option.value === selectedSize,
      ),
    );

    const byColor = product.variants.find((variant) =>
      variant.selectedOptions.some(
        (option) =>
          option.name.toLowerCase().includes("color") &&
          option.value === selectedColor,
      ),
    );

    return (
      product.variants.find((variant) => variant.id === selectedVariantId) ??
      bySize ??
      byColor ??
      product.variants[0]
    );
  }, [product.variants, selectedColor, selectedSize, selectedVariantId]);

  const displayImage = activeImage;

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-border bg-lilac/20">
          <Image
            src={displayImage}
            alt={product.name}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        </div>
        {gallery.length > 1 ? (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {gallery.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveImage(image)}
                className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                  displayImage === image
                    ? "border-brand ring-2 ring-brand/20"
                    : "border-border hover:border-brand/50"
                }`}
                aria-label={`View ${product.name} image ${index + 1}`}
              >
                <Image
                  src={image}
                  alt={`${product.name} view ${index + 1}`}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {selectedColor}
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold text-ink">
            {product.name}
          </h1>
          <StarRating
            rating={product.rating}
            reviewCount={product.reviewCount}
            size="md"
            className="mt-4"
          />
        </div>

        <p className="font-display text-3xl font-bold text-ink">
          {formatPrice(selectedVariant?.price ?? product.price)}
        </p>

        <p className="leading-relaxed text-muted">
          {product.description ??
            "Premium performance scrubs with advanced fabric technology for healthcare professionals. Engineered for comfort during long shifts."}
        </p>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Color
          </p>
          <div className="flex flex-wrap gap-3">
            {product.colors.map((color) => (
              <button
                key={color.name}
                type="button"
                onClick={() => setSelectedColor(color.name)}
                className={`h-10 w-10 rounded-full border-2 ${
                  selectedColor === color.name
                    ? "border-brand ring-2 ring-brand/20"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Size
          </p>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => {
                  setSelectedSize(size);
                  const match = product.variants?.find((variant) =>
                    variant.selectedOptions.some(
                      (option) =>
                        option.name.toLowerCase().includes("size") &&
                        option.value === size,
                    ),
                  );
                  if (match) setSelectedVariantId(match.id);
                }}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                  selectedSize === size
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border hover:border-brand"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <Link
            href="/size-guide"
            className="mt-3 inline-block text-sm font-semibold text-brand hover:underline"
          >
            View Size Guide
          </Link>
        </div>

        <div className="flex flex-wrap gap-4 pt-4">
          <AddToCartButton
            product={product}
            variant={selectedVariant}
            size="lg"
          />
          <AddToCartButton
            product={product}
            variant={selectedVariant}
            size="lg"
            variantStyle="outline"
            label="Buy Now"
            redirectToCheckout
          />
          <WishlistButton product={product} className="border border-border p-4" />
        </div>
      </div>
    </div>
  );
}
