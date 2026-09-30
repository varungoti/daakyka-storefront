import type { ProductImage } from "@/lib/types";

export interface SelectedProductGallery {
  images: { url: string; alt: string }[];
  verifiedViews: number;
  representativeFallback: boolean;
}

/** Never show another colour or an explicitly different size as the selected variant. */
export function selectProductGallery(input: {
  images: ProductImage[];
  productName: string;
  color: string;
  size: string;
  colorCount: number;
}): SelectedProductGallery {
  const { images, productName, color, size, colorCount } = input;
  const matchingColor = images.filter((image) =>
    image.color === color || (colorCount === 1 && !image.color),
  );
  const verified = matchingColor.filter((image) =>
    image.size === size || (!image.size && image.appliesToAllSizes === true),
  );
  // Untagged legacy or AI imagery can illustrate the same colour while its
  // size applicability is reviewed. Keep it visible even after one of the
  // other photos is verified, but never count it toward the release gate.
  const representative = matchingColor.filter((image) =>
    !image.size && !image.appliesToAllSizes && image.url !== "/placeholder-product.svg",
  );
  const chosen = matchingColor.filter((image) => verified.includes(image) || representative.includes(image));
  if (chosen.length === 0) {
    return {
      images: [{ url: "/placeholder-product.svg", alt: `${productName} photo unavailable in ${color}, size ${size}` }],
      verifiedViews: 0,
      representativeFallback: false,
    };
  }
  const seen = new Set<string>();
  const distinct = chosen.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
  return {
    images: distinct.map((image) => ({ url: image.url, alt: image.alt ?? productName })),
    verifiedViews: new Set(verified.map((image) => image.url)).size,
    representativeFallback: representative.length > 0,
  };
}
