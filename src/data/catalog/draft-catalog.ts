/**
 * Draft launch catalog (Phase E1).
 *
 * A typed, framework-free data module — no Prisma imports here — so it can
 * be unit tested on its own (uniqueness, pricing sanity, category
 * references) and consumed by `prisma/seed-catalog.ts` without pulling in
 * a database connection just to validate the data shape.
 *
 * Every product is seeded as `DRAFT` for the client to review (see plan
 * Phase E1). Prices are realistic Indian INR draft pricing, not final —
 * daakyka.com lists no prices publicly.
 */

export type CategorySection = "HOSPITAL" | "SCHOOL" | "KIDS" | "GENERAL";

export type DraftProductGender =
  | "MEN"
  | "WOMEN"
  | "UNISEX"
  | "BOYS"
  | "GIRLS"
  | "KIDS";

export interface DraftCategory {
  slug: string;
  name: string;
  description?: string;
  section: CategorySection;
  parentSlug?: string;
  sortOrder: number;
  showInMenu: boolean;
  sizeChartKey?: string;
}

export interface DraftSizeChartRow {
  [column: string]: string | number;
}

export interface DraftSizeChart {
  key: string;
  name: string;
  unit: "IN" | "CM";
  columns: string[];
  rows: DraftSizeChartRow[];
  notes?: string;
}

export interface DraftColor {
  name: string;
  hex: string;
}

export interface DraftVariant {
  sku: string;
  size: string;
  color: string;
  colorHex: string;
  stock: number;
}

export interface DraftProduct {
  slug: string;
  name: string;
  categorySlug: string;
  shortDescription: string;
  description: string;
  fabric: string;
  care: string;
  gender: DraftProductGender;
  tags: string[];
  featured: boolean;
  isNew: boolean;
  price: number;
  compareAtPrice?: number;
  sizeChartKey?: string;
  variants: DraftVariant[];
}

// ---------------------------------------------------------------------------
// Category tree (see plan sections C2 and E1)
// ---------------------------------------------------------------------------

export const draftCategories: DraftCategory[] = [
  // For Hospitals
  {
    slug: "for-hospitals",
    name: "For Hospitals",
    description: "Scrubs, gowns, uniforms and linens for healthcare teams.",
    section: "HOSPITAL",
    sortOrder: 10,
    showInMenu: true,
  },
  {
    slug: "scrub-sets",
    name: "Scrub Sets",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 11,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "scrub-tops",
    name: "Scrub Tops",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 12,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "scrub-pants",
    name: "Scrub Pants",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 13,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "lab-coats-aprons",
    name: "Lab Coats & Aprons",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 14,
    showInMenu: true,
    sizeChartKey: "lab-coats",
  },
  {
    slug: "ot-surgical-gowns",
    name: "OT / Surgical Gowns",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 15,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "patient-gowns",
    name: "Patient Gowns",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 16,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "staff-nurse-uniforms",
    name: "Staff & Nurse Uniforms",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 17,
    showInMenu: true,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "hospital-linens",
    name: "Hospital Linens",
    description: "Bedsheets, pillow covers and draw sheets for wards and patient rooms.",
    section: "HOSPITAL",
    parentSlug: "for-hospitals",
    sortOrder: 18,
    showInMenu: true,
    sizeChartKey: "linens",
  },
  {
    slug: "bedsheets",
    name: "Bedsheets",
    section: "HOSPITAL",
    parentSlug: "hospital-linens",
    sortOrder: 19,
    showInMenu: true,
    sizeChartKey: "linens",
  },
  {
    slug: "pillow-covers",
    name: "Pillow Covers",
    section: "HOSPITAL",
    parentSlug: "hospital-linens",
    sortOrder: 20,
    showInMenu: true,
    sizeChartKey: "linens",
  },
  {
    slug: "draw-sheets",
    name: "Draw Sheets",
    section: "HOSPITAL",
    parentSlug: "hospital-linens",
    sortOrder: 21,
    showInMenu: true,
    sizeChartKey: "linens",
  },

  // School Uniforms
  {
    slug: "school-uniforms",
    name: "School Uniforms",
    description: "Shirts, tunics, trousers, skirts, blazers and sportswear for schools.",
    section: "SCHOOL",
    sortOrder: 30,
    showInMenu: true,
  },
  {
    slug: "school-shirts",
    name: "Shirts",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 31,
    showInMenu: true,
    sizeChartKey: "school-shirts",
  },
  {
    slug: "tunics",
    name: "Tunics",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 32,
    showInMenu: true,
    sizeChartKey: "school-shirts",
  },
  {
    slug: "school-trousers",
    name: "Trousers",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 33,
    showInMenu: true,
    sizeChartKey: "school-trousers",
  },
  {
    slug: "skirts-pinafores",
    name: "Skirts & Pinafores",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 34,
    showInMenu: true,
    sizeChartKey: "school-trousers",
  },
  {
    slug: "blazers",
    name: "Made-to-Measure Blazers",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 35,
    showInMenu: true,
    sizeChartKey: "school-shirts",
  },
  {
    slug: "sweaters",
    name: "Sweaters",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 36,
    showInMenu: true,
    sizeChartKey: "school-shirts",
  },
  {
    slug: "sports-pe",
    name: "Sports / PE",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 37,
    showInMenu: true,
    sizeChartKey: "school-trousers",
  },
  {
    slug: "ties-belts",
    name: "Ties & Belts",
    section: "SCHOOL",
    parentSlug: "school-uniforms",
    sortOrder: 38,
    showInMenu: true,
  },

  // Kids Wear
  {
    slug: "kids-wear",
    name: "Kids Wear",
    description: "Everyday cotton wear for kids.",
    section: "KIDS",
    sortOrder: 50,
    showInMenu: true,
  },
  {
    slug: "kids-tshirts",
    name: "Kids T-Shirts",
    section: "KIDS",
    parentSlug: "kids-wear",
    sortOrder: 51,
    showInMenu: true,
    sizeChartKey: "kids-wear",
  },
  {
    slug: "kids-joggers",
    name: "Kids Joggers",
    section: "KIDS",
    parentSlug: "kids-wear",
    sortOrder: 52,
    showInMenu: true,
    sizeChartKey: "kids-wear",
  },
  {
    slug: "frocks",
    name: "Frocks",
    section: "KIDS",
    parentSlug: "kids-wear",
    sortOrder: 53,
    showInMenu: true,
    sizeChartKey: "kids-wear",
  },
  {
    slug: "kids-co-ords",
    name: "Kids Co-ords",
    section: "KIDS",
    parentSlug: "kids-wear",
    sortOrder: 54,
    showInMenu: true,
    sizeChartKey: "kids-wear",
  },
  {
    slug: "kids-hoodies",
    name: "Kids Hoodies",
    section: "KIDS",
    parentSlug: "kids-wear",
    sortOrder: 55,
    showInMenu: true,
    sizeChartKey: "kids-wear",
  },

  // General (hidden from the main menu by default)
  {
    slug: "corporate-uniforms",
    name: "Corporate Uniforms",
    description: "Executive and corporate wear — toggle on in site controls to list in the menu.",
    section: "GENERAL",
    sortOrder: 70,
    showInMenu: false,
    sizeChartKey: "adult-scrubs",
  },
  {
    slug: "sports-teams",
    name: "Sports & Teams",
    description: "Team jerseys and tracksuit kits for clubs and academies.",
    section: "GENERAL",
    sortOrder: 71,
    showInMenu: false,
    sizeChartKey: "adult-scrubs",
  },
];

// ---------------------------------------------------------------------------
// Size charts
// ---------------------------------------------------------------------------

export const draftSizeCharts: DraftSizeChart[] = [
  {
    key: "adult-scrubs",
    name: "Adult Scrubs",
    unit: "IN",
    columns: ["Size", "Chest", "Waist", "Length"],
    rows: [
      { Size: "XS", Chest: 34, Waist: 28, Length: 26 },
      { Size: "S", Chest: 36, Waist: 30, Length: 27 },
      { Size: "M", Chest: 38, Waist: 32, Length: 28 },
      { Size: "L", Chest: 40, Waist: 34, Length: 29 },
      { Size: "XL", Chest: 42, Waist: 36, Length: 30 },
      { Size: "2XL", Chest: 44, Waist: 38, Length: 31 },
      { Size: "3XL", Chest: 46, Waist: 40, Length: 32 },
    ],
    notes: "Measurements in inches, laid flat. Allow 0.5–1\" for comfortable movement.",
  },
  {
    key: "lab-coats",
    name: "Lab Coats",
    unit: "IN",
    columns: ["Size", "Chest", "Length", "Sleeve"],
    rows: [
      { Size: "S", Chest: 38, Length: 40, Sleeve: 23 },
      { Size: "M", Chest: 40, Length: 41, Sleeve: 23.5 },
      { Size: "L", Chest: 42, Length: 42, Sleeve: 24 },
      { Size: "XL", Chest: 44, Length: 43, Sleeve: 24.5 },
      { Size: "2XL", Chest: 46, Length: 44, Sleeve: 25 },
      { Size: "3XL", Chest: 48, Length: 45, Sleeve: 25.5 },
    ],
  },
  {
    key: "school-shirts",
    name: "School Shirts",
    unit: "IN",
    columns: ["Size (Chest)", "Approx. Age"],
    rows: [
      { "Size (Chest)": 20, "Approx. Age": "3–4Y" },
      { "Size (Chest)": 22, "Approx. Age": "5–6Y" },
      { "Size (Chest)": 24, "Approx. Age": "6–7Y" },
      { "Size (Chest)": 26, "Approx. Age": "7–8Y" },
      { "Size (Chest)": 28, "Approx. Age": "9–10Y" },
      { "Size (Chest)": 30, "Approx. Age": "10–11Y" },
      { "Size (Chest)": 32, "Approx. Age": "12–13Y" },
      { "Size (Chest)": 34, "Approx. Age": "13–14Y" },
      { "Size (Chest)": 36, "Approx. Age": "15–16Y / Adult S" },
      { "Size (Chest)": 38, "Approx. Age": "Adult M" },
      { "Size (Chest)": 40, "Approx. Age": "Adult L" },
      { "Size (Chest)": 42, "Approx. Age": "Adult XL" },
      { "Size (Chest)": 44, "Approx. Age": "Adult 2XL" },
    ],
    notes: "Size number is the chest measurement in inches, the convention used on the garment label.",
  },
  {
    key: "school-trousers",
    name: "School Trousers",
    unit: "IN",
    columns: ["Waist", "Length"],
    rows: [
      { Waist: 20, Length: 28 },
      { Waist: 22, Length: 29 },
      { Waist: 24, Length: 30 },
      { Waist: 26, Length: 31 },
      { Waist: 28, Length: 32 },
      { Waist: 30, Length: 33 },
      { Waist: 32, Length: 34 },
      { Waist: 34, Length: 38 },
      { Waist: 36, Length: 39 },
      { Waist: 38, Length: 40 },
      { Waist: 40, Length: 41 },
    ],
  },
  {
    key: "kids-wear",
    name: "Kids Wear",
    unit: "CM",
    columns: ["Age", "Height (cm)", "Chest (in)"],
    rows: [
      { Age: "2–3Y", "Height (cm)": "92–98", "Chest (in)": 21 },
      { Age: "4–5Y", "Height (cm)": "104–110", "Chest (in)": 22 },
      { Age: "6–7Y", "Height (cm)": "116–122", "Chest (in)": 24 },
      { Age: "8–9Y", "Height (cm)": "128–134", "Chest (in)": 26 },
      { Age: "10–11Y", "Height (cm)": "140–146", "Chest (in)": 28 },
      { Age: "12–13Y", "Height (cm)": "152–158", "Chest (in)": 30 },
      { Age: "13–14Y", "Height (cm)": "158–164", "Chest (in)": 32 },
    ],
  },
  {
    key: "linens",
    name: "Linens",
    unit: "IN",
    columns: ["Item", "Dimensions"],
    rows: [
      { Item: "Single Bedsheet", Dimensions: "60\" x 90\"" },
      { Item: "Double Bedsheet", Dimensions: "90\" x 100\"" },
      { Item: "King Bedsheet", Dimensions: "108\" x 108\"" },
      { Item: "Pillow Cover (Standard)", Dimensions: "17\" x 27\"" },
      { Item: "Draw Sheet (Standard)", Dimensions: "36\" x 60\"" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Colour palettes
// ---------------------------------------------------------------------------

const hospital = {
  navy: { name: "Navy", hex: "#1E3A5F" },
  ceilBlue: { name: "Ceil Blue", hex: "#8FB8DE" },
  wine: { name: "Wine", hex: "#722F37" },
  hunterGreen: { name: "Hunter Green", hex: "#355E3B" },
  black: { name: "Black", hex: "#1F2937" },
  white: { name: "White", hex: "#F5F5F4" },
} as const;

const school = {
  white: { name: "White", hex: "#F5F5F4" },
  skyBlue: { name: "Sky Blue", hex: "#AEE1F9" },
  grey: { name: "Grey", hex: "#9CA3AF" },
  navy: { name: "Navy", hex: "#1E3A5F" },
  maroon: { name: "Maroon", hex: "#7B1E2E" },
} as const;

const kids = {
  red: { name: "Red", hex: "#DC2626" },
  yellow: { name: "Yellow", hex: "#FACC15" },
  mint: { name: "Mint", hex: "#6EE7B7" },
  skyBlue: { name: "Sky Blue", hex: "#AEE1F9" },
  pink: { name: "Pink", hex: "#F9A8D4" },
  navy: { name: "Navy", hex: "#1E3A5F" },
  grey: { name: "Grey", hex: "#9CA3AF" },
} as const;

const linen = {
  white: { name: "White", hex: "#F5F5F4" },
  paleSky: { name: "Pale Sky", hex: "#DCEEFB" },
} as const;

// ---------------------------------------------------------------------------
// Variant + SKU generation
// ---------------------------------------------------------------------------

const ADULT_SCRUB_SIZES = ["S", "M", "L", "XL", "2XL"];
const LAB_COAT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const SCHOOL_SHIRT_SIZES = ["22", "24", "26", "28", "30", "32"];
const SCHOOL_TROUSER_SIZES = ["24", "26", "28", "30", "32"];
const KIDS_SIZES = ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y"];
const LINEN_BEDSHEET_SIZES = ["Single", "Double", "King"];
const STANDARD_SIZE = ["Standard"];
const MADE_TO_MEASURE_SIZE = ["Made to Measure"];

/** Deterministic 10-80 stock figure derived from the SKU, so re-running the
 * generator (and the seed) always produces the same numbers. */
function stockFor(sku: string): number {
  let hash = 0;
  for (let i = 0; i < sku.length; i += 1) {
    hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
  }
  return 10 + (hash % 71);
}

function colorCode(name: string): string {
  const alpha = name.replace(/[^a-zA-Z]/g, "");
  return alpha.slice(0, 3).toUpperCase() || "GEN";
}

function buildVariants(
  categoryCode: string,
  slug: string,
  sizes: string[],
  colors: DraftColor[],
): DraftVariant[] {
  const abbrev = slug.replace(/-/g, "").slice(0, 20).toUpperCase();
  const variants: DraftVariant[] = [];
  for (const size of sizes) {
    const sizeCode = size.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    for (const color of colors) {
      const sku = `DK-${categoryCode}-${abbrev}-${sizeCode}-${colorCode(color.name)}`;
      variants.push({
        sku,
        size,
        color: color.name,
        colorHex: color.hex,
        stock: stockFor(sku),
      });
    }
  }
  return variants;
}

interface ProductSpec {
  slug: string;
  name: string;
  categorySlug: string;
  categoryCode: string;
  gender: DraftProductGender;
  colors: DraftColor[];
  sizes: string[];
  price: number;
  compareAtPrice?: number;
  fabric: string;
  care: string;
  shortDescription: string;
  description: string;
  tags?: string[];
  featured?: boolean;
  isNew?: boolean;
  sizeChartKey?: string;
}

const SCRUB_CARE = "Machine wash cold with like colours, tumble dry low, do not bleach.";
const COTTON_CARE = "Machine wash warm, line dry in shade, iron on medium heat.";
const LINEN_CARE = "Machine wash hot for hospital-grade hygiene, tumble dry, iron before use.";
const SCHOOL_CARE = "Machine wash cold, do not bleach, iron on medium heat.";
const KIDS_CARE = "Machine wash cold, gentle cycle, tumble dry low.";

function spec(partial: ProductSpec): ProductSpec {
  return partial;
}

const productSpecs: ProductSpec[] = [
  // ---------------- For Hospitals: scrub-sets ----------------
  spec({
    slug: "classic-unisex-scrub-set",
    name: "Classic Unisex Scrub Set",
    categorySlug: "scrub-sets",
    categoryCode: "SCR",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.ceilBlue, hospital.wine, hospital.hunterGreen],
    sizes: ADULT_SCRUB_SIZES,
    price: 1499,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A comfortable everyday scrub top and pants set for hospital wards.",
    description:
      "A classic V-neck top and drawstring pant set in breathable poly-cotton, built for long shifts. Roomy pockets and a relaxed fit make it a dependable everyday choice for ward staff.",
    tags: ["scrubs", "hospital", "unisex", "everyday"],
    featured: true,
  }),
  spec({
    slug: "antimicrobial-scrub-set",
    name: "Antimicrobial Scrub Set",
    categorySlug: "scrub-sets",
    categoryCode: "SCR",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.black, hospital.ceilBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 1899,
    compareAtPrice: 2299,
    fabric: "Poly-cotton 65/35 with an antimicrobial finish",
    care: SCRUB_CARE,
    shortDescription: "Scrub set with an antimicrobial fabric finish for high-contact wards.",
    description:
      "The same relaxed top-and-pant silhouette as our classic set, finished with an antimicrobial fabric treatment aimed at reducing odour build-up over a shift. Reinforced seams for repeated laundering.",
    tags: ["scrubs", "hospital", "unisex", "antimicrobial"],
  }),
  spec({
    slug: "womens-vneck-scrub-set",
    name: "Women's V-Neck Scrub Set",
    categorySlug: "scrub-sets",
    categoryCode: "SCR",
    gender: "WOMEN",
    colors: [hospital.wine, hospital.navy, hospital.ceilBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 1699,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A tailored V-neck scrub set cut for a women's fit.",
    description:
      "A fitted V-neck top paired with a tapered jogger pant, tailored to a women's silhouette without sacrificing range of movement. Includes a side pocket for a phone or badge.",
    tags: ["scrubs", "hospital", "women"],
  }),
  spec({
    slug: "mens-utility-scrub-set",
    name: "Men's Utility Scrub Set",
    categorySlug: "scrub-sets",
    categoryCode: "SCR",
    gender: "MEN",
    colors: [hospital.navy, hospital.hunterGreen, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 1799,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A utility-cut scrub set with extra pocket storage for men.",
    description:
      "A straight-cut top with a chest pocket and cargo-style pant pockets for the instruments and notes a shift needs close at hand. Durable stitching for daily wear.",
    tags: ["scrubs", "hospital", "men"],
  }),

  // ---------------- scrub-tops ----------------
  spec({
    slug: "womens-vneck-scrub-top",
    name: "Women's V-Neck Scrub Top",
    categorySlug: "scrub-tops",
    categoryCode: "SCT",
    gender: "WOMEN",
    colors: [hospital.wine, hospital.ceilBlue, hospital.white],
    sizes: ADULT_SCRUB_SIZES,
    price: 899,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A single V-neck scrub top to mix and match with any scrub pant.",
    description:
      "A lightweight V-neck top with a curved hem and two front pockets, designed to pair with any of our scrub pants for a mix-and-match wardrobe.",
    tags: ["scrubs", "hospital", "women", "top"],
  }),
  spec({
    slug: "mens-round-neck-scrub-top",
    name: "Men's Round Neck Scrub Top",
    categorySlug: "scrub-tops",
    categoryCode: "SCT",
    gender: "MEN",
    colors: [hospital.navy, hospital.hunterGreen],
    sizes: ADULT_SCRUB_SIZES,
    price: 849,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A straightforward round neck scrub top for daily wear.",
    description:
      "A no-fuss round neck top with a chest pocket, cut with enough room for an undershirt in cooler wards.",
    tags: ["scrubs", "hospital", "men", "top"],
  }),
  spec({
    slug: "unisex-mandarin-collar-scrub-top",
    name: "Unisex Mandarin Collar Scrub Top",
    categorySlug: "scrub-tops",
    categoryCode: "SCT",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.ceilBlue, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 949,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A mandarin-collar scrub top with a slightly smarter finish.",
    description:
      "A mandarin collar gives this top a tidier profile at the neckline while keeping the same easy-care poly-cotton and generous pocket layout.",
    tags: ["scrubs", "hospital", "unisex", "top"],
    isNew: true,
  }),

  // ---------------- scrub-pants ----------------
  spec({
    slug: "unisex-jogger-scrub-pants",
    name: "Unisex Jogger Scrub Pants",
    categorySlug: "scrub-pants",
    categoryCode: "SCP",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.black, hospital.hunterGreen],
    sizes: ADULT_SCRUB_SIZES,
    price: 799,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "Elastic-cuff jogger scrub pants for easy movement.",
    description:
      "A drawstring waist and elastic cuffs keep these joggers comfortable through a full shift, with two side pockets and a back utility pocket.",
    tags: ["scrubs", "hospital", "unisex", "pants"],
  }),
  spec({
    slug: "womens-slim-scrub-pants",
    name: "Women's Slim Scrub Pants",
    categorySlug: "scrub-pants",
    categoryCode: "SCP",
    gender: "WOMEN",
    colors: [hospital.wine, hospital.navy],
    sizes: ADULT_SCRUB_SIZES,
    price: 849,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A slim-leg scrub pant tailored for a women's fit.",
    description:
      "A tapered leg and elastic-and-drawstring waistband combine for a fitted look that still moves with you on rounds.",
    tags: ["scrubs", "hospital", "women", "pants"],
  }),
  spec({
    slug: "mens-cargo-scrub-pants",
    name: "Men's Cargo Scrub Pants",
    categorySlug: "scrub-pants",
    categoryCode: "SCP",
    gender: "MEN",
    colors: [hospital.navy, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 899,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A cargo-pocket scrub pant with extra storage.",
    description:
      "A side cargo pocket on each leg gives room for shears, a torch or a notepad, alongside the standard front and back pockets.",
    tags: ["scrubs", "hospital", "men", "pants"],
  }),

  // ---------------- lab-coats-aprons ----------------
  spec({
    slug: "classic-lab-coat",
    name: "Classic Lab Coat",
    categorySlug: "lab-coats-aprons",
    categoryCode: "LAB",
    gender: "UNISEX",
    colors: [hospital.white],
    sizes: LAB_COAT_SIZES,
    price: 1099,
    fabric: "100% cotton drill",
    care: "Dry clean or machine wash warm, iron while damp.",
    shortDescription: "A full-length button-front lab coat in cotton drill.",
    description:
      "A traditional full-length lab coat in a sturdy cotton drill, with a button front, chest pocket and two lower patch pockets.",
    tags: ["lab-coat", "hospital", "unisex"],
  }),
  spec({
    slug: "full-sleeve-lab-apron",
    name: "Full-Sleeve Lab Apron",
    categorySlug: "lab-coats-aprons",
    categoryCode: "LAB",
    gender: "UNISEX",
    colors: [hospital.white],
    sizes: LAB_COAT_SIZES,
    price: 899,
    fabric: "100% cotton drill",
    care: "Dry clean or machine wash warm, iron while damp.",
    shortDescription: "A lighter full-sleeve apron alternative to a full lab coat.",
    description:
      "A shorter, apron-style alternative to the full lab coat, with full-length sleeves and a tie-back closure for a closer fit.",
    tags: ["lab-coat", "apron", "hospital"],
  }),
  spec({
    slug: "half-sleeve-doctors-coat",
    name: "Half-Sleeve Doctor's Coat",
    categorySlug: "lab-coats-aprons",
    categoryCode: "LAB",
    gender: "UNISEX",
    colors: [hospital.white],
    sizes: LAB_COAT_SIZES,
    price: 1299,
    compareAtPrice: 1599,
    fabric: "100% cotton drill",
    care: "Dry clean or machine wash warm, iron while damp.",
    shortDescription: "A half-sleeve coat for warmer wards or long OPD hours.",
    description:
      "A half-sleeve cut for warmer departments or long OPD hours, in the same durable cotton drill as our full-length coats.",
    tags: ["lab-coat", "hospital", "unisex"],
  }),

  // ---------------- ot-surgical-gowns ----------------
  spec({
    slug: "reusable-ot-surgical-gown",
    name: "Reusable OT Surgical Gown",
    categorySlug: "ot-surgical-gowns",
    categoryCode: "OTG",
    gender: "UNISEX",
    colors: [hospital.ceilBlue, hospital.hunterGreen],
    sizes: ADULT_SCRUB_SIZES,
    price: 1399,
    fabric: "Poly-viscose fluid-resistant weave",
    care: "Machine wash hot per hospital laundry protocol, do not bleach.",
    shortDescription: "A reusable surgical gown in a fluid-resistant weave.",
    description:
      "A back-tie reusable surgical gown in a tightly woven poly-viscose fabric, designed to withstand repeated hospital-grade laundering.",
    tags: ["ot-gown", "surgical", "hospital"],
  }),
  spec({
    slug: "wraparound-ot-gown",
    name: "Wraparound OT Gown",
    categorySlug: "ot-surgical-gowns",
    categoryCode: "OTG",
    gender: "UNISEX",
    colors: [hospital.ceilBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 1499,
    fabric: "Poly-viscose fluid-resistant weave",
    care: "Machine wash hot per hospital laundry protocol, do not bleach.",
    shortDescription: "A wraparound-style surgical gown for easier gowning.",
    description:
      "A wraparound closure makes gowning and de-gowning quicker between procedures, in the same fluid-resistant weave as our reusable gown.",
    tags: ["ot-gown", "surgical", "hospital"],
  }),

  // ---------------- patient-gowns ----------------
  spec({
    slug: "standard-patient-gown",
    name: "Standard Patient Gown",
    categorySlug: "patient-gowns",
    categoryCode: "PTG",
    gender: "UNISEX",
    colors: [hospital.white, hospital.ceilBlue],
    sizes: ["S", "M", "L", "XL"],
    price: 599,
    fabric: "Poly-cotton 65/35",
    care: LINEN_CARE,
    shortDescription: "A back-tie patient gown for ward and OPD use.",
    description:
      "A simple back-tie gown in soft poly-cotton, designed for repeated hospital laundering and easy dressing for patients.",
    tags: ["patient-gown", "hospital"],
  }),
  spec({
    slug: "maternity-patient-gown",
    name: "Maternity Patient Gown",
    categorySlug: "patient-gowns",
    categoryCode: "PTG",
    gender: "WOMEN",
    colors: [hospital.white],
    sizes: ["M", "L", "XL", "2XL"],
    price: 649,
    fabric: "Poly-cotton 65/35",
    care: LINEN_CARE,
    shortDescription: "A roomier patient gown cut for maternity wards.",
    description:
      "A relaxed-fit gown with a front-opening option for maternity and postnatal wards, in the same easy-care poly-cotton as our standard gown.",
    tags: ["patient-gown", "maternity", "hospital"],
  }),

  // ---------------- staff-nurse-uniforms ----------------
  spec({
    slug: "nurse-duty-uniform-set",
    name: "Nurse Duty Uniform Set",
    categorySlug: "staff-nurse-uniforms",
    categoryCode: "STF",
    gender: "WOMEN",
    colors: [hospital.white, hospital.ceilBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 1299,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A structured duty uniform set for nursing staff.",
    description:
      "A fitted tunic-and-pant duty set with a name badge loop and pen pocket, tailored for daily nursing duty.",
    tags: ["nurse-uniform", "staff", "hospital"],
  }),
  spec({
    slug: "staff-uniform-shirt-trouser-set",
    name: "Staff Uniform Shirt & Trouser Set",
    categorySlug: "staff-nurse-uniforms",
    categoryCode: "STF",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.hunterGreen],
    sizes: ADULT_SCRUB_SIZES,
    price: 1399,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A shirt-and-trouser uniform set for hospital support staff.",
    description:
      "A collared shirt and matching trouser set for administrative and support staff who need a smarter, non-scrub uniform.",
    tags: ["staff-uniform", "hospital"],
  }),
  spec({
    slug: "housekeeping-staff-uniform",
    name: "Housekeeping Staff Uniform",
    categorySlug: "staff-nurse-uniforms",
    categoryCode: "STF",
    gender: "UNISEX",
    colors: [hospital.navy, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 999,
    fabric: "Poly-cotton 65/35",
    care: SCRUB_CARE,
    shortDescription: "A hard-wearing uniform set for housekeeping teams.",
    description:
      "A practical, hard-wearing uniform for housekeeping and facilities staff, with reinforced stitching at stress points.",
    tags: ["staff-uniform", "housekeeping", "hospital"],
  }),

  // ---------------- hospital-linens: bedsheets ----------------
  spec({
    slug: "cotton-hospital-bedsheet",
    name: "Cotton Hospital Bedsheet",
    categorySlug: "bedsheets",
    categoryCode: "BED",
    gender: "UNISEX",
    colors: [linen.white, linen.paleSky],
    sizes: LINEN_BEDSHEET_SIZES,
    price: 599,
    fabric: "100% cotton, 180 TC",
    care: LINEN_CARE,
    shortDescription: "A durable cotton bedsheet for ward and patient beds.",
    description:
      "A plain-weave 180 thread-count cotton bedsheet sized for standard hospital beds, built to withstand frequent hot-water laundering.",
    tags: ["linens", "bedsheet", "hospital"],
  }),
  spec({
    slug: "premium-percale-bedsheet",
    name: "Premium Percale Bedsheet",
    categorySlug: "bedsheets",
    categoryCode: "BED",
    gender: "UNISEX",
    colors: [linen.white],
    sizes: LINEN_BEDSHEET_SIZES,
    price: 899,
    compareAtPrice: 1099,
    fabric: "100% cotton percale, 220 TC",
    care: LINEN_CARE,
    shortDescription: "A higher thread-count percale sheet for a crisper finish.",
    description:
      "A tighter percale weave at 220 thread count for a crisper, more premium feel, still rated for regular hospital laundering.",
    tags: ["linens", "bedsheet", "hospital"],
  }),

  // ---------------- pillow-covers ----------------
  spec({
    slug: "hospital-pillow-cover",
    name: "Hospital Pillow Cover",
    categorySlug: "pillow-covers",
    categoryCode: "PIL",
    gender: "UNISEX",
    colors: [linen.white, linen.paleSky],
    sizes: STANDARD_SIZE,
    price: 149,
    fabric: "100% cotton, 180 TC",
    care: LINEN_CARE,
    shortDescription: "A standard-size cotton pillow cover for wards.",
    description:
      "A plain cotton pillow cover in the standard hospital pillow size, matched to our bedsheet fabric for a consistent set.",
    tags: ["linens", "pillow-cover", "hospital"],
  }),

  // ---------------- draw-sheets ----------------
  spec({
    slug: "waterproof-draw-sheet",
    name: "Waterproof Draw Sheet",
    categorySlug: "draw-sheets",
    categoryCode: "DRS",
    gender: "UNISEX",
    colors: [linen.white],
    sizes: STANDARD_SIZE,
    price: 349,
    fabric: "Cotton face with a waterproof backing layer",
    care: "Machine wash warm, do not tumble dry hot (protects the waterproof layer).",
    shortDescription: "A waterproof-backed draw sheet for patient beds.",
    description:
      "A cotton-faced draw sheet with a waterproof backing layer, placed across the middle of the bed to protect the mattress and ease patient repositioning.",
    tags: ["linens", "draw-sheet", "hospital"],
  }),

  // ---------------- school-shirts ----------------
  spec({
    slug: "boys-white-school-shirt",
    name: "Boys White School Shirt",
    categorySlug: "school-shirts",
    categoryCode: "SHS",
    gender: "BOYS",
    colors: [school.white],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 399,
    fabric: "Poly-cotton 65/35",
    care: SCHOOL_CARE,
    shortDescription: "A classic white school shirt for daily wear.",
    description:
      "A durable poly-cotton shirt that holds its colour and shape through frequent school-week washing.",
    tags: ["school", "shirt", "boys"],
  }),
  spec({
    slug: "girls-sky-blue-school-shirt",
    name: "Girls Sky Blue School Shirt",
    categorySlug: "school-shirts",
    categoryCode: "SHS",
    gender: "GIRLS",
    colors: [school.skyBlue],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 399,
    fabric: "Poly-cotton 65/35",
    care: SCHOOL_CARE,
    shortDescription: "A sky blue school shirt cut for a girls' fit.",
    description:
      "A soft poly-cotton shirt in a girls' cut, made to match most sky-blue school uniform codes.",
    tags: ["school", "shirt", "girls"],
  }),
  spec({
    slug: "half-sleeve-school-shirt",
    name: "Half-Sleeve School Shirt",
    categorySlug: "school-shirts",
    categoryCode: "SHS",
    gender: "UNISEX",
    colors: [school.white, school.skyBlue],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 349,
    fabric: "Poly-cotton 65/35",
    care: SCHOOL_CARE,
    shortDescription: "A half-sleeve shirt for warmer months.",
    description:
      "A short-sleeve version of our school shirt for warmer months, in the same easy-care poly-cotton.",
    tags: ["school", "shirt", "unisex"],
    isNew: true,
  }),

  // ---------------- tunics ----------------
  spec({
    slug: "classic-school-tunic",
    name: "Classic School Tunic",
    categorySlug: "tunics",
    categoryCode: "TUN",
    gender: "GIRLS",
    colors: [school.navy, school.maroon],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 599,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "A classic sleeveless school tunic.",
    description:
      "A sleeveless tunic in a durable poly-viscose blend, worn over a school shirt, with a box-pleat front for ease of movement.",
    tags: ["school", "tunic", "girls"],
  }),
  spec({
    slug: "pleated-school-tunic",
    name: "Pleated School Tunic",
    categorySlug: "tunics",
    categoryCode: "TUN",
    gender: "GIRLS",
    colors: [school.navy],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 649,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "A fully pleated school tunic.",
    description:
      "An all-round pleated skirt section gives this tunic more movement than our classic style, still in easy-care poly-viscose.",
    tags: ["school", "tunic", "girls"],
  }),

  // ---------------- school-trousers ----------------
  spec({
    slug: "boys-grey-school-trousers",
    name: "Boys Grey School Trousers",
    categorySlug: "school-trousers",
    categoryCode: "STR",
    gender: "BOYS",
    colors: [school.grey],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 449,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "Grey school trousers with an adjustable waist.",
    description:
      "A straight-leg trouser with an adjustable elastic waistband to allow for growth across a school term.",
    tags: ["school", "trousers", "boys"],
  }),
  spec({
    slug: "boys-navy-school-trousers",
    name: "Boys Navy School Trousers",
    categorySlug: "school-trousers",
    categoryCode: "STR",
    gender: "BOYS",
    colors: [school.navy],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 449,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "Navy school trousers with an adjustable waist.",
    description:
      "The same adjustable-waist straight-leg trouser as our grey style, in navy for schools with a navy uniform code.",
    tags: ["school", "trousers", "boys"],
  }),
  spec({
    slug: "girls-school-trousers",
    name: "Girls School Trousers",
    categorySlug: "school-trousers",
    categoryCode: "STR",
    gender: "GIRLS",
    colors: [school.grey, school.navy],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 469,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "School trousers cut for a girls' fit.",
    description:
      "A tapered-leg trouser cut for a girls' fit, with the same adjustable waistband as our boys' styles.",
    tags: ["school", "trousers", "girls"],
  }),

  // ---------------- skirts-pinafores ----------------
  spec({
    slug: "school-pinafore",
    name: "School Pinafore",
    categorySlug: "skirts-pinafores",
    categoryCode: "SKP",
    gender: "GIRLS",
    colors: [school.navy, school.maroon],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 549,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "A pinafore dress worn over a school shirt.",
    description:
      "A sleeveless pinafore dress with a box-pleat skirt, worn over a school shirt, in a durable poly-viscose blend.",
    tags: ["school", "pinafore", "girls"],
  }),
  spec({
    slug: "box-pleat-school-skirt",
    name: "Box-Pleat School Skirt",
    categorySlug: "skirts-pinafores",
    categoryCode: "SKP",
    gender: "GIRLS",
    colors: [school.grey, school.navy],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 499,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "A box-pleat school skirt with an adjustable waist.",
    description:
      "An all-round box-pleat skirt with an adjustable waistband, designed to keep its shape through daily wear.",
    tags: ["school", "skirt", "girls"],
  }),
  spec({
    slug: "a-line-school-skirt",
    name: "A-Line School Skirt",
    categorySlug: "skirts-pinafores",
    categoryCode: "SKP",
    gender: "GIRLS",
    colors: [school.navy],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 479,
    compareAtPrice: 599,
    fabric: "Poly-viscose",
    care: SCHOOL_CARE,
    shortDescription: "A simpler A-line school skirt.",
    description:
      "A flat-front A-line skirt for schools that prefer a simpler silhouette than a box-pleat style.",
    tags: ["school", "skirt", "girls"],
  }),

  // ---------------- blazers (made-to-measure) ----------------
  spec({
    slug: "made-to-measure-single-breasted-blazer",
    name: "Made-to-Measure Single-Breasted Blazer",
    categorySlug: "blazers",
    categoryCode: "BLZ",
    gender: "UNISEX",
    colors: [school.navy, school.maroon],
    sizes: MADE_TO_MEASURE_SIZE,
    price: 2499,
    fabric: "Wool-blend suiting",
    care: "Dry clean only.",
    shortDescription: "A made-to-measure single-breasted school blazer.",
    description:
      "Cut to individual measurements rather than a standard size chart, this single-breasted blazer is finished with the school's badge on request. Enquire for bulk measurement scheduling.",
    tags: ["school", "blazer", "made-to-measure"],
  }),
  spec({
    slug: "made-to-measure-double-breasted-blazer",
    name: "Made-to-Measure Double-Breasted Blazer",
    categorySlug: "blazers",
    categoryCode: "BLZ",
    gender: "UNISEX",
    colors: [school.navy],
    sizes: MADE_TO_MEASURE_SIZE,
    price: 2999,
    fabric: "Wool-blend suiting",
    care: "Dry clean only.",
    shortDescription: "A made-to-measure double-breasted school blazer.",
    description:
      "A double-breasted cut for schools with a more formal uniform code, made to individual measurements taken on-site for bulk orders.",
    tags: ["school", "blazer", "made-to-measure"],
  }),

  // ---------------- sweaters ----------------
  spec({
    slug: "v-neck-school-sweater",
    name: "V-Neck School Sweater",
    categorySlug: "sweaters",
    categoryCode: "SWT",
    gender: "UNISEX",
    colors: [school.navy, school.maroon, school.grey],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 549,
    fabric: "Acrylic knit",
    care: "Hand wash or machine wash cold on a gentle cycle.",
    shortDescription: "A V-neck knit sweater for cooler months.",
    description:
      "A lightweight acrylic knit V-neck sweater, worn over a school shirt in the cooler months.",
    tags: ["school", "sweater"],
  }),
  spec({
    slug: "round-neck-school-pullover",
    name: "Round Neck School Pullover",
    categorySlug: "sweaters",
    categoryCode: "SWT",
    gender: "UNISEX",
    colors: [school.navy, school.grey],
    sizes: SCHOOL_SHIRT_SIZES,
    price: 499,
    fabric: "Acrylic knit",
    care: "Hand wash or machine wash cold on a gentle cycle.",
    shortDescription: "A round-neck knit pullover for cooler months.",
    description:
      "A round-neck alternative to our V-neck sweater, in the same soft acrylic knit.",
    tags: ["school", "sweater"],
  }),

  // ---------------- sports-pe ----------------
  spec({
    slug: "pe-jersey",
    name: "PE Jersey",
    categorySlug: "sports-pe",
    categoryCode: "SPE",
    gender: "UNISEX",
    colors: [school.navy, school.skyBlue],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 399,
    fabric: "Polyester pique",
    care: "Machine wash cold, line dry.",
    shortDescription: "A breathable PE jersey for sports periods.",
    description:
      "A moisture-friendly polyester pique jersey for PE and sports periods, with set-in sleeves for freedom of movement.",
    tags: ["school", "sports", "pe"],
  }),
  spec({
    slug: "pe-shorts",
    name: "PE Shorts",
    categorySlug: "sports-pe",
    categoryCode: "SPE",
    gender: "UNISEX",
    colors: [school.navy],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 299,
    fabric: "Polyester pique",
    care: "Machine wash cold, line dry.",
    shortDescription: "Elastic-waist PE shorts.",
    description:
      "An elastic-and-drawstring waist PE short in a quick-drying polyester weave.",
    tags: ["school", "sports", "pe"],
  }),
  spec({
    slug: "school-tracksuit",
    name: "School Tracksuit",
    categorySlug: "sports-pe",
    categoryCode: "SPE",
    gender: "UNISEX",
    colors: [school.navy, school.grey],
    sizes: SCHOOL_TROUSER_SIZES,
    price: 999,
    fabric: "Polyester fleece",
    care: "Machine wash cold, line dry.",
    shortDescription: "A full tracksuit for sports and outdoor periods.",
    description:
      "A zip-front jacket and matching trouser in brushed polyester fleece, for outdoor sports periods and cooler months.",
    tags: ["school", "sports", "tracksuit"],
    featured: true,
  }),

  // ---------------- ties-belts ----------------
  spec({
    slug: "school-tie",
    name: "School Tie",
    categorySlug: "ties-belts",
    categoryCode: "TIB",
    gender: "UNISEX",
    colors: [school.navy, school.maroon],
    sizes: STANDARD_SIZE,
    price: 149,
    fabric: "Polyester twill",
    care: "Spot clean only.",
    shortDescription: "A pre-tied school tie in house colours.",
    description:
      "A pre-shaped, elastic-strap school tie in polyester twill, quick to put on before the morning bell.",
    tags: ["school", "accessories", "tie"],
  }),
  spec({
    slug: "school-belt",
    name: "School Belt",
    categorySlug: "ties-belts",
    categoryCode: "TIB",
    gender: "UNISEX",
    colors: [school.navy, hospital.black],
    sizes: STANDARD_SIZE,
    price: 199,
    fabric: "PU webbing",
    care: "Wipe clean.",
    shortDescription: "A simple buckle belt in house colours.",
    description:
      "A webbing belt with a plain metal buckle, sized to fit most school trouser waistbands.",
    tags: ["school", "accessories", "belt"],
  }),

  // ---------------- kids-tshirts ----------------
  spec({
    slug: "kids-cotton-tshirt",
    name: "Kids Cotton T-Shirt",
    categorySlug: "kids-tshirts",
    categoryCode: "KTS",
    gender: "KIDS",
    colors: [kids.red, kids.yellow, kids.mint, kids.skyBlue],
    sizes: KIDS_SIZES,
    price: 349,
    fabric: "100% cotton",
    care: KIDS_CARE,
    shortDescription: "A soft everyday cotton T-shirt for kids.",
    description:
      "A simple crew-neck T-shirt in soft, breathable cotton for everyday play and comfort.",
    tags: ["kids", "tshirt", "everyday"],
    isNew: true,
  }),
  spec({
    slug: "kids-printed-tshirt",
    name: "Kids Printed T-Shirt",
    categorySlug: "kids-tshirts",
    categoryCode: "KTS",
    gender: "KIDS",
    colors: [kids.skyBlue, kids.pink],
    sizes: KIDS_SIZES,
    price: 399,
    fabric: "100% cotton",
    care: KIDS_CARE,
    shortDescription: "A printed cotton T-shirt for kids.",
    description:
      "The same soft cotton crew-neck as our plain T-shirt, with a playful front print.",
    tags: ["kids", "tshirt"],
  }),

  // ---------------- kids-joggers ----------------
  spec({
    slug: "kids-jogger-pants",
    name: "Kids Jogger Pants",
    categorySlug: "kids-joggers",
    categoryCode: "KJG",
    gender: "KIDS",
    colors: [kids.navy, kids.grey],
    sizes: KIDS_SIZES,
    price: 449,
    fabric: "Cotton-lycra blend",
    care: KIDS_CARE,
    shortDescription: "Stretch-cuff jogger pants for kids.",
    description:
      "An elastic waist and stretch cuffs make these joggers easy to move in, from the playground to the classroom.",
    tags: ["kids", "joggers"],
  }),
  spec({
    slug: "kids-track-pants",
    name: "Kids Track Pants",
    categorySlug: "kids-joggers",
    categoryCode: "KJG",
    gender: "KIDS",
    colors: [kids.navy, kids.red],
    sizes: KIDS_SIZES,
    price: 429,
    fabric: "Cotton-lycra blend",
    care: KIDS_CARE,
    shortDescription: "Everyday track pants for kids.",
    description:
      "A straightforward elastic-waist track pant in a soft cotton-lycra blend for everyday wear.",
    tags: ["kids", "track-pants"],
  }),

  // ---------------- frocks ----------------
  spec({
    slug: "kids-cotton-frock",
    name: "Kids Cotton Frock",
    categorySlug: "frocks",
    categoryCode: "FRK",
    gender: "GIRLS",
    colors: [kids.pink, kids.yellow],
    sizes: KIDS_SIZES,
    price: 599,
    fabric: "100% cotton",
    care: KIDS_CARE,
    shortDescription: "An everyday cotton frock for kids.",
    description:
      "A simple, comfortable cotton frock with a flared skirt for everyday wear.",
    tags: ["kids", "frock", "girls"],
  }),
  spec({
    slug: "party-frock",
    name: "Party Frock",
    categorySlug: "frocks",
    categoryCode: "FRK",
    gender: "GIRLS",
    colors: [kids.pink],
    sizes: KIDS_SIZES,
    price: 799,
    compareAtPrice: 999,
    fabric: "Cotton with a net overlay",
    care: "Hand wash cold, do not wring, line dry in shade.",
    shortDescription: "A dressier frock with a net overlay for special occasions.",
    description:
      "A fuller, dressier frock with a net overlay skirt for birthdays and special occasions.",
    tags: ["kids", "frock", "party", "girls"],
  }),

  // ---------------- kids-co-ords ----------------
  spec({
    slug: "kids-co-ord-set",
    name: "Kids Co-ord Set",
    categorySlug: "kids-co-ords",
    categoryCode: "KCO",
    gender: "KIDS",
    colors: [kids.mint, kids.skyBlue],
    sizes: KIDS_SIZES,
    price: 649,
    fabric: "100% cotton",
    care: KIDS_CARE,
    shortDescription: "A matching top-and-shorts co-ord set for kids.",
    description:
      "A matching short-sleeve top and shorts set in soft cotton, an easy grab-and-go outfit.",
    tags: ["kids", "co-ord"],
  }),
  spec({
    slug: "kids-summer-co-ord",
    name: "Kids Summer Co-ord",
    categorySlug: "kids-co-ords",
    categoryCode: "KCO",
    gender: "KIDS",
    colors: [kids.yellow, kids.pink],
    sizes: KIDS_SIZES,
    price: 599,
    fabric: "100% cotton",
    care: KIDS_CARE,
    shortDescription: "A lightweight summer co-ord set for kids.",
    description:
      "A lighter-weight cotton co-ord for warmer months, in the same matching top-and-bottom format.",
    tags: ["kids", "co-ord", "summer"],
  }),

  // ---------------- kids-hoodies ----------------
  spec({
    slug: "kids-hoodie",
    name: "Kids Hoodie",
    categorySlug: "kids-hoodies",
    categoryCode: "KHD",
    gender: "KIDS",
    colors: [kids.navy, kids.grey, kids.red],
    sizes: KIDS_SIZES,
    price: 599,
    fabric: "Cotton fleece",
    care: KIDS_CARE,
    shortDescription: "A pull-over fleece hoodie for cooler days.",
    description:
      "A soft cotton fleece pull-over hoodie with a kangaroo pocket, for cooler mornings and evenings.",
    tags: ["kids", "hoodie"],
    featured: true,
  }),
  spec({
    slug: "kids-zip-hoodie",
    name: "Kids Zip Hoodie",
    categorySlug: "kids-hoodies",
    categoryCode: "KHD",
    gender: "KIDS",
    colors: [kids.navy, kids.mint],
    sizes: KIDS_SIZES,
    price: 649,
    fabric: "Cotton fleece",
    care: KIDS_CARE,
    shortDescription: "A full-zip fleece hoodie for cooler days.",
    description:
      "A full-zip version of our pull-over hoodie, easier for younger kids to put on and take off by themselves.",
    tags: ["kids", "hoodie"],
  }),

  // ---------------- corporate-uniforms (hidden by default) ----------------
  spec({
    slug: "executive-shirt",
    name: "Executive Shirt",
    categorySlug: "corporate-uniforms",
    categoryCode: "COR",
    gender: "UNISEX",
    colors: [school.white, school.skyBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 899,
    fabric: "Poly-cotton 65/35",
    care: COTTON_CARE,
    shortDescription: "A tailored shirt for corporate uniform programmes.",
    description:
      "A tailored corporate shirt in a wrinkle-resistant poly-cotton blend, suited to front-of-house and office teams.",
    tags: ["corporate", "shirt"],
  }),
  spec({
    slug: "executive-trousers",
    name: "Executive Trousers",
    categorySlug: "corporate-uniforms",
    categoryCode: "COR",
    gender: "UNISEX",
    colors: [school.navy, hospital.black, school.grey],
    sizes: ADULT_SCRUB_SIZES,
    price: 999,
    fabric: "Poly-viscose suiting",
    care: "Dry clean or machine wash cold, hang to dry.",
    shortDescription: "A tailored trouser for corporate uniform programmes.",
    description:
      "A flat-front tailored trouser in a poly-viscose suiting fabric, designed for daily office wear.",
    tags: ["corporate", "trousers"],
  }),
  spec({
    slug: "corporate-skirt",
    name: "Corporate Skirt",
    categorySlug: "corporate-uniforms",
    categoryCode: "COR",
    gender: "WOMEN",
    colors: [school.navy, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 899,
    fabric: "Poly-viscose suiting",
    care: "Dry clean or machine wash cold, hang to dry.",
    shortDescription: "A tailored pencil skirt for corporate uniform programmes.",
    description:
      "A knee-length pencil skirt in a poly-viscose suiting fabric, matched to our executive trousers and jacket.",
    tags: ["corporate", "skirt"],
  }),
  spec({
    slug: "corporate-blazer-jacket",
    name: "Corporate Blazer Jacket",
    categorySlug: "corporate-uniforms",
    categoryCode: "COR",
    gender: "UNISEX",
    colors: [school.navy, hospital.black],
    sizes: ADULT_SCRUB_SIZES,
    price: 2499,
    fabric: "Poly-viscose suiting",
    care: "Dry clean only.",
    shortDescription: "A tailored blazer jacket for corporate uniform programmes.",
    description:
      "A single-breasted blazer jacket in poly-viscose suiting, finished with a chest pocket for a corporate logo on request.",
    tags: ["corporate", "jacket"],
  }),

  // ---------------- sports-teams (hidden by default) ----------------
  spec({
    slug: "team-jersey-kit",
    name: "Team Jersey Kit",
    categorySlug: "sports-teams",
    categoryCode: "SPT",
    gender: "UNISEX",
    colors: [school.navy, kids.red, school.skyBlue],
    sizes: ADULT_SCRUB_SIZES,
    price: 699,
    fabric: "Polyester pique",
    care: "Machine wash cold, line dry.",
    shortDescription: "A team jersey for clubs and academies.",
    description:
      "A breathable polyester pique jersey suited to bulk team orders, with room for a name and number on the back.",
    tags: ["sports", "team", "jersey"],
  }),
  spec({
    slug: "team-tracksuit-kit",
    name: "Team Tracksuit Kit",
    categorySlug: "sports-teams",
    categoryCode: "SPT",
    gender: "UNISEX",
    colors: [school.navy, school.grey],
    sizes: ADULT_SCRUB_SIZES,
    price: 1499,
    fabric: "Polyester fleece",
    care: "Machine wash cold, line dry.",
    shortDescription: "A team tracksuit for clubs and academies.",
    description:
      "A zip-front jacket and matching trouser in brushed polyester fleece, suited to bulk team and academy orders.",
    tags: ["sports", "team", "tracksuit"],
  }),
];

export const draftProducts: DraftProduct[] = productSpecs.map((p) => ({
  slug: p.slug,
  name: p.name,
  categorySlug: p.categorySlug,
  shortDescription: p.shortDescription,
  description: p.description,
  fabric: p.fabric,
  care: p.care,
  gender: p.gender,
  tags: p.tags ?? [],
  featured: p.featured ?? false,
  isNew: p.isNew ?? false,
  price: p.price,
  compareAtPrice: p.compareAtPrice,
  sizeChartKey: p.sizeChartKey,
  variants: buildVariants(p.categoryCode, p.slug, p.sizes, p.colors),
}));

export const draftCategorySlugs = new Set(draftCategories.map((c) => c.slug));
export const draftSizeChartKeys = new Set(draftSizeCharts.map((c) => c.key));
