"use client";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { MixMatchControls } from "@/components/mix-match/mix-match-controls";
import {
  applyFavoriteToConfig,
  MixMatchFavoritesPanel,
} from "@/components/mix-match/mix-match-favorites-panel";
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
import { tryOnAvatars } from "@/data/media/catalog";
import { useOutfitTryOn } from "@/hooks/use-outfit-try-on";
import { resolveMixMatchProducts } from "@/lib/mix-match/resolve-products";
import type { TryOnGender } from "@/lib/outfit/types";
import type { Product } from "@/lib/types";
import { Check, Heart, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";

interface MixMatchStudioBuilderProps {
  products: Product[];
}

const SAVED_OUTFITS_KEY = "daakyka-saved-outfits";

export function MixMatchStudioBuilder({ products }: MixMatchStudioBuilderProps) {
  const { formatPrice } = useCurrency();
  const { addToCart, openCart, isLoading } = useCart();
  const [config, setConfig] = useState<MixMatchConfig>(defaultMixMatchConfig);
  const [gender, setGender] = useState<TryOnGender>("female");

  const resolved = useMemo(
    () => resolveMixMatchProducts(products, config),
    [products, config],
  );

  const tryOnRequest = useMemo(() => {
    if (!resolved.topImage) return null;
    return {
      gender,
      topImageUrl: resolved.topImage,
      bottomImageUrl: resolved.bottomImage || undefined,
      avatarImageUrl: tryOnAvatars[gender],
      topHandle: resolved.topProduct?.handle,
      bottomHandle: resolved.bottomProduct?.handle,
      color: config.color,
    };
  }, [gender, resolved, config.color]);

  const { previewUrl, loading: tryOnLoading, result } = useOutfitTryOn(tryOnRequest, {
    enabled: Boolean(resolved.topImage),
  });

  const tintHex = mixMatchColors.find((c) => c.name === config.color)?.hex;
  const topLabel = topStyleOptions.find((o) => o.id === config.topStyle)?.label ?? "";
  const bottomLabel = bottomStyleOptions.find((o) => o.id === config.bottomStyle)?.label ?? "";
  const fabricLabel = fabricOptions.find((f) => f.id === config.fabric)?.label ?? "";
  const setTotal = (resolved.topProduct?.price ?? 0) + (resolved.bottomProduct?.price ?? 0);

  const displayImage =
    previewUrl || resolved.topImage || tryOnAvatars[gender];

  const update = <K extends keyof MixMatchConfig>(key: K, value: MixMatchConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const applyFavorite = (product: Product) => {
    const patch = applyFavoriteToConfig(product, config);
    setConfig((current) => ({ ...current, ...patch }));
    if (product.colorName) {
      update("color", product.colorName);
    }
  };

  const saveCurrentLook = () => {
    try {
      const stored = localStorage.getItem(SAVED_OUTFITS_KEY);
      const outfits = stored ? (JSON.parse(stored) as unknown[]) : [];
      outfits.unshift({
        id: crypto.randomUUID(),
        config,
        gender,
        previewUrl: previewUrl ?? resolved.topImage,
        savedAt: new Date().toISOString(),
      });
      localStorage.setItem(SAVED_OUTFITS_KEY, JSON.stringify(outfits.slice(0, 20)));
    } catch {
      /* ignore storage errors */
    }
  };

  const handleAddSet = async () => {
    if (!resolved.topProduct || !resolved.bottomProduct || !resolved.topVariant || !resolved.bottomVariant) {
      return;
    }
    await addToCart({
      variantId: resolved.topVariant.id,
      productHandle: resolved.topProduct.handle,
      productTitle: resolved.topProduct.name,
      variantTitle: resolved.topVariant.title,
      price: resolved.topVariant.price,
      image: resolved.topVariant.image ?? resolved.topProduct.image,
    });
    await addToCart({
      variantId: resolved.bottomVariant.id,
      productHandle: resolved.bottomProduct.handle,
      productTitle: resolved.bottomProduct.name,
      variantTitle: resolved.bottomVariant.title,
      price: resolved.bottomVariant.price,
      image: resolved.bottomVariant.image ?? resolved.bottomProduct.image,
    });
    openCart();
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.05fr)] xl:items-start">
        <div className="space-y-6 xl:sticky xl:top-28">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">Outfit Studio</p>
            <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight text-ink md:text-4xl">
              Mix, Match & Make It Yours
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">
              CPU-powered AR try-on with MediaPipe pose mapping — every Shopify scrub variant applies
              instantly on preset avatars.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              "3D Live Preview",
              "Male & Female Models",
              "Custom Embroidery Preview",
              "Perfect Fit Guarantee",
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
          </div>

          <div className="flex flex-col gap-3">
            {resolved.topProduct && resolved.topVariant && (
              <AddToCartButton
                product={resolved.topProduct}
                variant={resolved.topVariant}
                label="Add Top to Cart"
              />
            )}
            {resolved.bottomProduct && resolved.bottomVariant && (
              <AddToCartButton
                product={resolved.bottomProduct}
                variant={resolved.bottomVariant}
                label="Add Bottom to Cart"
                variantStyle="outline"
              />
            )}
            <Button className="w-full" size="lg" onClick={handleAddSet} disabled={isLoading}>
              <ShoppingBag size={18} />
              Add Complete Set to Cart
            </Button>
            <Button variant="outline" className="w-full" onClick={saveCurrentLook} type="button">
              <Heart size={16} />
              Save Current Look
            </Button>
          </div>
        </div>

        <MixMatchVisualizer
          imageSrc={displayImage}
          imageAlt={`${topLabel} and ${bottomLabel} try-on preview`}
          topLabel={topLabel}
          bottomLabel={bottomLabel}
          colorLabel={config.color}
          fabricLabel={fabricLabel}
          embroideryName={config.embroideryName || undefined}
          tintHex={tintHex}
          loading={tryOnLoading}
          gender={gender}
          onGenderChange={setGender}
          genderLabel={gender === "male" ? "Male model" : "Female model"}
          modeLabel={
            result?.mode === "ar-tryon"
              ? "AR try-on render"
              : "Live garment preview"
          }
        />

        <div className="space-y-5 xl:sticky xl:top-28">
          <MixMatchControls
            layout="studio"
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
          <MixMatchFavoritesPanel
            onApplyProduct={applyFavorite}
            activeTopHandle={resolved.topProduct?.handle}
            activeBottomHandle={resolved.bottomProduct?.handle}
          />
        </div>
      </div>
    </div>
  );
}
