import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchProducts } from "@/lib/search/match-products";
import type { Product } from "@/lib/types";

/** Minimal fixture builder — only the fields matchProducts reads. */
function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    handle: overrides.id,
    colorName: "Navy",
    price: 999,
    rating: 0,
    reviewCount: 0,
    category: "scrub-tops",
    categorySlug: "scrub-tops",
    categoryName: "Scrub Tops",
    colors: [{ name: "Navy", hex: "#1E3A5F" }],
    sizes: ["M"],
    fabricTech: [],
    image: "/img.jpg",
    tags: [],
    section: "HOSPITAL",
    ...overrides,
  };
}

const scrubTop = product({ id: "scrub-top", name: "V-Neck Scrub Top", tags: ["scrubs", "hospital", "top"] });
const scrubSet = product({
  id: "scrub-set",
  name: "Classic Unisex Scrub Set",
  category: "scrub-sets",
  categorySlug: "scrub-sets",
  categoryName: "Scrub Sets",
  tags: ["scrubs", "hospital"],
});
const labCoat = product({
  id: "lab-coat",
  name: "Classic Lab Coat",
  category: "lab-coats",
  categorySlug: "lab-coats",
  categoryName: "Lab Coats",
  tags: ["lab-coat", "hospital"],
});
const bedsheet = product({
  id: "bedsheet",
  name: "Cotton Hospital Bedsheet",
  category: "bedsheets",
  categorySlug: "bedsheets",
  categoryName: "Bedsheets",
  tags: ["linens", "bedsheet", "hospital"],
});
const doctorCoat = product({
  id: "doctor-coat",
  name: "Half-Sleeve Doctor's Coat",
  category: "lab-coats",
  categorySlug: "lab-coats",
  categoryName: "Lab Coats",
  tags: ["lab-coat", "hospital"],
});
const patientGown = product({
  id: "patient-gown",
  name: "Patient Gown",
  category: "patient-gowns",
  categorySlug: "patient-gowns",
  categoryName: "Patient Gowns",
  tags: ["patient-gown", "hospital"],
});
const schoolTie = product({
  id: "school-tie",
  name: "School Tie",
  category: "ties-belts",
  categorySlug: "ties-belts",
  categoryName: "Ties & Belts",
  section: "SCHOOL",
  tags: ["school", "accessories", "tie"],
});
const antimicrobialSet = product({
  id: "antimicrobial-set",
  name: "Antimicrobial Scrub Set",
  category: "scrub-sets",
  categorySlug: "scrub-sets",
  categoryName: "Scrub Sets",
  tags: ["scrubs", "hospital", "antimicrobial"],
  fabricTech: ["anti-microbial"],
});
const kidsHoodie = product({
  id: "kids-hoodie",
  name: "Kids Hoodie",
  category: "kids-hoodies",
  categorySlug: "kids-hoodies",
  categoryName: "Kids Hoodies",
  section: "KIDS",
  tags: ["kids", "hoodie"],
});

const allProducts = [
  scrubTop,
  scrubSet,
  labCoat,
  bedsheet,
  doctorCoat,
  patientGown,
  schoolTie,
  antimicrobialSet,
  kidsHoodie,
];

describe("matchProducts (release-hardening audit F-082)", () => {
  it("matches a plural query against singular tags ('scrubs')", () => {
    const result = matchProducts(allProducts, "scrubs");
    const ids = result.map((p) => p.handle);
    assert.ok(ids.includes("scrub-top"));
    assert.ok(ids.includes("scrub-set"));
    assert.ok(ids.includes("antimicrobial-set"));
    assert.ok(!ids.includes("lab-coat"));
  });

  it("matches a two-word category query ('scrub tops')", () => {
    const result = matchProducts(allProducts, "scrub tops");
    assert.deepEqual(result.map((p) => p.handle), ["scrub-top"]);
  });

  it("matches plural multi-word queries ('lab coats')", () => {
    const result = matchProducts(allProducts, "lab coats");
    const ids = result.map((p) => p.handle);
    assert.ok(ids.includes("lab-coat"));
    assert.ok(ids.includes("doctor-coat"));
  });

  it("matches a spaced query against an unspaced product name ('bed sheet' -> Bedsheet)", () => {
    const result = matchProducts(allProducts, "bed sheet");
    assert.deepEqual(result.map((p) => p.handle), ["bedsheet"]);
  });

  it("matches a plural query against a singular tag ('linen')", () => {
    const result = matchProducts(allProducts, "linen");
    assert.deepEqual(result.map((p) => p.handle), ["bedsheet"]);
  });

  it("matches 'doctors' against \"Doctor's Coat\" via the apostrophe-stripped stem", () => {
    const result = matchProducts(allProducts, "doctors");
    assert.deepEqual(result.map((p) => p.handle), ["doctor-coat"]);
  });

  it("matches 'hospital' against every HOSPITAL-section product, not just a literal name hit", () => {
    const result = matchProducts(allProducts, "hospital");
    const ids = result.map((p) => p.handle);
    for (const expected of ["scrub-top", "scrub-set", "lab-coat", "bedsheet", "doctor-coat", "patient-gown", "antimicrobial-set"]) {
      assert.ok(ids.includes(expected), `expected ${expected} to match "hospital"`);
    }
    assert.ok(!ids.includes("kids-hoodie"));
  });

  it("matches 'tie' by prefix, without matching 'patient' (F-082's false-positive case)", () => {
    const result = matchProducts(allProducts, "tie");
    assert.deepEqual(result.map((p) => p.handle), ["school-tie"]);
  });

  it("matches a hyphenated fabric technology query ('anti-microbial')", () => {
    const result = matchProducts(allProducts, "anti-microbial");
    assert.deepEqual(result.map((p) => p.handle), ["antimicrobial-set"]);
  });

  it("is case-insensitive", () => {
    const result = matchProducts(allProducts, "SCRUB TOPS");
    assert.deepEqual(result.map((p) => p.handle), ["scrub-top"]);
  });

  it("ranks a product-name match above a tag-only match", () => {
    const nameMatch = product({ id: "name-match", name: "Scrub Cap", tags: ["accessories"] });
    const tagOnlyMatch = product({ id: "tag-only-match", name: "Everyday Cotton Set", tags: ["scrubs", "hospital"] });
    const result = matchProducts([tagOnlyMatch, nameMatch], "scrub");
    assert.deepEqual(result.map((p) => p.handle), ["name-match", "tag-only-match"]);
  });

  it("returns nothing for a blank query", () => {
    assert.deepEqual(matchProducts(allProducts, "   "), []);
  });

  it("does not stem a short word like 'pe'", () => {
    const peKit = product({ id: "pe-kit", name: "PE Kit", tags: ["school", "pe"] });
    assert.deepEqual(
      matchProducts([...allProducts, peKit], "pe").map((p) => p.handle),
      ["pe-kit"],
    );
  });
});

// F-102: in-results search matched only name, first colour and the category
// *slug*, so "Scrub Tops" found 0 products and "lab coat" found 1 of 3. The
// shared matcher (F-082) already tokenises against the category display name
// and every colour; these pin the cases the audit reported.
describe("matchProducts: the F-102 queries", () => {
  it("finds a category by its display name, in any case ('Scrub Tops')", () => {
    const result = matchProducts(allProducts, "Scrub Tops");
    assert.deepEqual(result.map((p) => p.handle), ["scrub-top"]);
  });

  it("finds every product in a category from the singular query ('lab coat')", () => {
    const result = matchProducts(allProducts, "lab coat");
    assert.deepEqual(result.map((p) => p.handle).sort(), ["doctor-coat", "lab-coat"]);
  });

  it("matches a colour that is not the product's first colour", () => {
    const twoColours = product({
      id: "two-colours",
      name: "Everyday Tunic",
      colorName: "Navy",
      colors: [
        { name: "Navy", hex: "#1E3A5F" },
        { name: "Wine", hex: "#722F37" },
      ],
    });
    assert.deepEqual(matchProducts([twoColours, scrubTop], "wine").map((p) => p.handle), ["two-colours"]);
  });
});
