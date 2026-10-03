/** Curated, media-backed storefront feature order. Existing admin selections remain valid. */
export const FEATURED_PRODUCT_SLUGS = [
  "kids-hoodie",
  "kids-co-ord-set",
  "kids-cotton-frock",
  "kids-jogger-pants",
  "classic-unisex-scrub-set",
  "womens-vneck-scrub-set",
  "nurse-duty-uniform-set",
  "classic-lab-coat",
  "school-tracksuit",
  "school-pinafore",
  "classic-school-tunic",
  "half-sleeve-school-shirt",
] as const;

export const FEATURED_PRODUCT_SLUG_SET = new Set<string>(FEATURED_PRODUCT_SLUGS);
