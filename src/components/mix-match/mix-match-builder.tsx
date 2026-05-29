"use client";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { MixMatchControls } from "@/components/mix-match/mix-match-controls";
import { MixMatchVisualizer } from "@/components/mix-match/mix-match-visualizer";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import {
  bottomStyleOptions,
  defaultMixMatchConfig,
  fabricOptions,
  mixMatchColors,
  topStyleOptions,
  type MixMatchConfig,
} from "@/data/mix-match";
import { resolveMixMatchProducts } from "@/lib/mix-match/resolve-products";
import { productImage } from "@/data/media/catalog";
import type { Product } from "@/lib/types";
import { Check, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";

interface MixMatchBuilderProps {
  products: Product[];
}

export function MixMatchBuilder({ products }: MixMatchBuilderProps) {
  const { formatPrice } = useCurrency();
  const [config, setConfig] = useState<MixMatchConfig>(defaultMixMatchConfig);

  const resolved = useMemo(
    () => resolveMixMatchProducts(products, config),
    [products, config],
  );

  const { topProduct, bottomProduct, topVariant, bottomVariant, topImage } = resolved;

  const setTotal = (topProduct?.price ?? 0) + (bottomProduct?.price ?? 0);
  const tintHex = mixMatchColors.find((c) => c.name === config.color)?.hex;
  const topLabel = topStyleOptions.find((o) => o.id === config.topStyle)?.label ?? "";
  const bottomLabel = bottomStyleOptions.find((o) => o.id === config.bottomStyle)?.label ?? "";
  const fabricLabel = fabricOptions.find((f) => f.id === config.fabric)?.label ?? "";

  const previewImage =
    topImage ||
    topProduct?.image ||
    productImage(topStyleOptions.find((o) => o.id === config.topStyle)?.productHandle ?? "");

  const update = <K extends keyof MixMatchConfig>(key: K, value: MixMatchConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-10">
      <div className="grid gap-10 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.05fr)] xl:items-start xl:gap-8">
        {/* Left summary */}
        <div className="space-y-6 xl:sticky xl:top-28">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">
              Full Configurator
            </p>
            <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight text-ink md:text-4xl">
              Mix, Match & Make It Yours
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">
              Choose top, bottom, fabric, color and size — then add your complete set to cart in one
              tap.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              "Live Set Preview with Rotate",
              "Custom Embroidery Preview",
              "Perfect Fit Guarantee",
              "Add Complete Set to Cart",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm font-medium text-ink">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                  <Check size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Set Total</p>
            <p className="mt-1 font-display text-3xl font-bold text-brand">{formatPrice(setTotal)}</p>
            <p className="mt-1 text-sm text-muted">2 pieces · Size {config.size}</p>
            <div className="mt-4 space-y-1.5 text-sm text-muted">
              {topProduct && <p>Top: {topProduct.name}</p>}
              {bottomProduct && <p>Bottom: {bottomProduct.name}</p>}
              <p>Fabric: {fabricLabel}</p>
            </div>
          </div>

          <div className="space-y-3">
            {topProduct && topVariant && (
              <AddToCartButton product={topProduct} variant={topVariant} label="Add Top to Cart" />
            )}
            {bottomProduct && bottomVariant && (
              <AddToCartButton
                product={bottomProduct}
                variant={bottomVariant}
                label="Add Bottom to Cart"
                variantStyle="outline"
              />
            )}
            {topProduct && bottomProduct && topVariant && bottomVariant && (
              <AddSetButton
                topProduct={topProduct}
                bottomProduct={bottomProduct}
                topVariant={topVariant}
                bottomVariant={bottomVariant}
              />
            )}
          </div>
        </div>

        <MixMatchVisualizer
          imageSrc={previewImage}
          imageAlt={`${topLabel} and ${bottomLabel} preview`}
          topLabel={topLabel}
          bottomLabel={bottomLabel}
          colorLabel={config.color}
          fabricLabel={fabricLabel}
          embroideryName={config.embroideryName || undefined}
          tintHex={tintHex}
        />

        <MixMatchControls
          topStyle={config.topStyle}
          bottomStyle={config.bottomStyle}
          fabric={config.fabric}
          color={config.color}
          size={config.size}
          embroideryName={config.embroideryName}
          showSize
          onTopChange={(id) => update("topStyle", id)}
          onBottomChange={(id) => update("bottomStyle", id)}
          onFabricChange={(id) => update("fabric", id)}
          onColorChange={(name) => update("color", name)}
          onSizeChange={(size) => update("size", size)}
          onEmbroideryChange={(name) => update("embroideryName", name)}
        />
      </div>
    </div>
  );
}

function AddSetButton({
  topProduct,
  bottomProduct,
  topVariant,
  bottomVariant,
}: {
  topProduct: Product;
  bottomProduct: Product;
  topVariant: NonNullable<Product["variants"]>[number];
  bottomVariant: NonNullable<Product["variants"]>[number];
}) {
  const { addToCart, openCart, isLoading } = useCart();

  const handleAddSet = async () => {
    await addToCart({
      variantId: topVariant.id,
      productHandle: topProduct.handle,
      productTitle: topProduct.name,
      variantTitle: topVariant.title,
      price: topVariant.price,
      image: topVariant.image ?? topProduct.image,
    });
    await addToCart({
      variantId: bottomVariant.id,
      productHandle: bottomProduct.handle,
      productTitle: bottomProduct.name,
      variantTitle: bottomVariant.title,
      price: bottomVariant.price,
      image: bottomVariant.image ?? bottomProduct.image,
    });
    openCart();
  };

  return (
    <Button className="w-full" size="lg" onClick={handleAddSet} disabled={isLoading}>
      <ShoppingBag size={18} />
      Add Complete Set to Cart
    </Button>
  );
}
