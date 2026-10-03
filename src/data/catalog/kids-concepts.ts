/**
 * Twenty AI-illustrated Kids Wear concepts awaiting a physical sample,
 * supplier specifications, measured size run, price and stock verification.
 * They seed as zero-price DRAFT records without variants and cannot be
 * published by the existing admin listing toggle until variants are added.
 */
export interface KidsConcept {
  slug: string;
  name: string;
  categorySlug: "kids-tshirts" | "kids-joggers" | "frocks" | "kids-co-ords" | "kids-hoodies";
  color: string;
  design: string;
  gender: "KIDS" | "GIRLS";
}

export const kidsConcepts: KidsConcept[] = [
  { slug: "kids-raglan-play-tee", name: "Raglan Play Tee", categorySlug: "kids-tshirts", color: "Sky Blue / Navy", design: "Short-sleeve raglan tee with a sky-blue body and navy sleeves.", gender: "KIDS" },
  { slug: "kids-striped-pocket-tee", name: "Striped Pocket Tee", categorySlug: "kids-tshirts", color: "Yellow / Cream", design: "Short-sleeve striped tee with a small plain chest pocket.", gender: "KIDS" },
  { slug: "kids-henley-top", name: "Long-Sleeve Henley Top", categorySlug: "kids-tshirts", color: "Mint", design: "Long-sleeve henley top with a short button placket and ribbed cuffs.", gender: "KIDS" },
  { slug: "kids-colorblock-polo", name: "Colour-Block Polo", categorySlug: "kids-tshirts", color: "Navy / Sky Blue", design: "Short-sleeve polo with a navy body and sky-blue chest panel.", gender: "KIDS" },
  { slug: "kids-relaxed-crew-tee", name: "Relaxed Crew Tee", categorySlug: "kids-tshirts", color: "Coral Red", design: "Relaxed short-sleeve crew-neck tee with dropped shoulders.", gender: "KIDS" },
  { slug: "kids-cargo-joggers", name: "Cargo Joggers", categorySlug: "kids-joggers", color: "Olive Green", design: "Pull-on joggers with low-profile cargo pockets and cuffed ankles.", gender: "KIDS" },
  { slug: "kids-side-stripe-track-pants", name: "Side-Stripe Track Pants", categorySlug: "kids-joggers", color: "Navy / Sky Blue", design: "Pull-on track pants with a narrow contrast stripe down each leg.", gender: "KIDS" },
  { slug: "kids-straight-sweatpants", name: "Straight Sweatpants", categorySlug: "kids-joggers", color: "Heather Grey", design: "Straight-leg pull-on sweatpants with slant pockets.", gender: "KIDS" },
  { slug: "kids-cuffed-fleece-pants", name: "Cuffed Fleece Pants", categorySlug: "kids-joggers", color: "Deep Teal", design: "Pull-on fleece-style pants with broad ribbed ankle cuffs.", gender: "KIDS" },
  { slug: "kids-drawstring-joggers", name: "Drawstring Joggers", categorySlug: "kids-joggers", color: "Charcoal Grey", design: "Pull-on joggers with a visible drawstring and narrow ankle cuffs.", gender: "KIDS" },
  { slug: "kids-button-pinafore", name: "Button Pinafore", categorySlug: "frocks", color: "Butter Yellow", design: "Sleeveless pinafore with shoulder buttons and a softly gathered skirt.", gender: "GIRLS" },
  { slug: "kids-tiered-dress", name: "Tiered Dress", categorySlug: "frocks", color: "Blush Pink", design: "Short-sleeve dress with a round neckline and two gathered tiers.", gender: "GIRLS" },
  { slug: "kids-shirt-dress", name: "Shirt Dress", categorySlug: "frocks", color: "Sky Blue", design: "Short-sleeve shirt dress with front buttons and a fabric waist tie.", gender: "GIRLS" },
  { slug: "kids-pleated-occasion-dress", name: "Pleated Occasion Dress", categorySlug: "frocks", color: "Burgundy", design: "Sleeveless dress with a fitted bodice and broad skirt pleats.", gender: "GIRLS" },
  { slug: "kids-camp-collar-coord", name: "Camp-Collar Co-ord", categorySlug: "kids-co-ords", color: "Mint", design: "Two-piece set with a camp-collar shirt and matching shorts.", gender: "KIDS" },
  { slug: "kids-lounge-coord", name: "Long-Sleeve Lounge Co-ord", categorySlug: "kids-co-ords", color: "Lavender", design: "Two-piece set with a long-sleeve top and pull-on trousers.", gender: "KIDS" },
  { slug: "kids-sport-coord", name: "Sport Co-ord", categorySlug: "kids-co-ords", color: "Navy / White", design: "Two-piece set with a short-sleeve sports top and matching shorts.", gender: "KIDS" },
  { slug: "kids-sleeveless-summer-coord", name: "Sleeveless Summer Co-ord", categorySlug: "kids-co-ords", color: "Sunflower Yellow", design: "Two-piece set with a sleeveless top and relaxed shorts.", gender: "KIDS" },
  { slug: "kids-contrast-panel-hoodie", name: "Contrast-Panel Hoodie", categorySlug: "kids-hoodies", color: "Navy / Sky Blue", design: "Pullover hoodie with a contrast chest panel and kangaroo pocket.", gender: "KIDS" },
  { slug: "kids-pocket-zip-hoodie", name: "Pocket Zip Hoodie", categorySlug: "kids-hoodies", color: "Coral Red", design: "Full-zip hoodie with two square patch pockets and ribbed cuffs.", gender: "KIDS" },
];
