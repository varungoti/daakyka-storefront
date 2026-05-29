import {
  bottomStyleOptions,
  topStyleOptions,
  type MixMatchConfig,
} from "@/data/mix-match";
import type { Product, ProductVariant } from "@/lib/types";

export function resolveProductVariant(
  product: Product | undefined,
  size: string,
  color: string,
): ProductVariant | undefined {
  if (!product?.variants?.length) return undefined;

  const exact = product.variants.find(
    (variant) =>
      variant.selectedOptions.some((option) => option.name === "Size" && option.value === size) &&
      variant.selectedOptions.some((option) => option.name === "Color" && option.value === color),
  );
  if (exact) return exact;

  return product.variants.find((variant) =>
    variant.selectedOptions.some((option) => option.name === "Size" && option.value === size),
  );
}

export function resolveMixMatchProducts(
  products: Product[],
  config: MixMatchConfig,
): {
  topProduct?: Product;
  bottomProduct?: Product;
  topVariant?: ProductVariant;
  bottomVariant?: ProductVariant;
  topImage: string;
  bottomImage: string;
} {
  const topHandle = topStyleOptions.find((option) => option.id === config.topStyle)?.productHandle;
  const bottomHandle = bottomStyleOptions.find(
    (option) => option.id === config.bottomStyle,
  )?.productHandle;

  const topProduct = products.find((product) => product.handle === topHandle);
  const bottomProduct = products.find((product) => product.handle === bottomHandle);

  const topVariant = resolveProductVariant(topProduct, config.size, config.color);
  const bottomVariant = resolveProductVariant(bottomProduct, config.size, config.color);

  const topImage = topVariant?.image ?? topProduct?.image ?? "";
  const bottomImage = bottomVariant?.image ?? bottomProduct?.image ?? "";

  return { topProduct, bottomProduct, topVariant, bottomVariant, topImage, bottomImage };
}

export function findProductByHandle(products: Product[], handle: string): Product | undefined {
  return products.find((product) => product.handle === handle);
}
