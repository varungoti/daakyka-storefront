import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchProducts } from "@/lib/search/match-products";
import {
  loadSearchIndex,
  peekSearchIndex,
  preloadSearchIndex,
  resetSearchIndexForTests,
} from "@/lib/search/search-index";
import type { SearchProduct } from "@/lib/products/public-search-product";
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

/**
 * F-013: the header dialog used to `fetch("/api/products")` every time it
 * opened — and show "Searching..." for the whole round trip — although the
 * previous open's products were still in memory.
 */
describe("search index loader (F-013)", () => {
  const slim: SearchProduct = {
    id: "p1",
    handle: "scrub-top",
    name: "V-Neck Scrub Top",
    colorName: "Navy",
    price: 999,
    image: "/img.jpg",
    category: "scrub-tops",
    fabricTech: [],
    colors: [{ name: "Navy" }],
  };

  function fakeFetch(plan: Array<"ok" | "http-error" | "network-error">) {
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      const next = plan[Math.min(calls.length - 1, plan.length - 1)];
      if (next === "network-error") throw new Error("offline");
      if (next === "http-error") return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ products: [slim] }) };
    };
    return { calls, impl };
  }

  beforeEach(() => resetSearchIndexForTests());

  it("downloads the index once, however many times it is opened", async () => {
    const { calls, impl } = fakeFetch(["ok"]);
    assert.equal(peekSearchIndex(), null);
    const first = await loadSearchIndex(impl);
    const second = await loadSearchIndex(impl);
    const third = await loadSearchIndex(impl);
    assert.equal(calls.length, 1);
    assert.deepEqual(first, [slim]);
    assert.equal(second, first);
    assert.equal(third, first);
    assert.equal(peekSearchIndex(), first, "peek lets the dialog render results on its first frame");
  });

  it("shares one request between callers that ask while it is still in flight", async () => {
    const { calls, impl } = fakeFetch(["ok"]);
    const [a, b, c] = await Promise.all([loadSearchIndex(impl), loadSearchIndex(impl), loadSearchIndex(impl)]);
    assert.equal(calls.length, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("asks the unauthenticated catalogue index, not an admin or per-product route", async () => {
    const { calls, impl } = fakeFetch(["ok"]);
    await loadSearchIndex(impl);
    assert.deepEqual(calls, ["/api/products"]);
  });

  it("forgets a failed request, so the next open retries instead of keeping nothing for the session", async () => {
    const { calls, impl } = fakeFetch(["network-error", "http-error", "ok"]);
    await assert.rejects(() => loadSearchIndex(impl), /offline/);
    assert.equal(peekSearchIndex(), null);
    await assert.rejects(() => loadSearchIndex(impl), /Search index request failed/);
    assert.equal(peekSearchIndex(), null);
    assert.deepEqual(await loadSearchIndex(impl), [slim]);
    assert.equal(calls.length, 3);
  });

  it("treats a response with no products as an empty index (and keeps it)", async () => {
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({}) };
    };
    assert.deepEqual(await loadSearchIndex(impl), []);
    assert.deepEqual(await loadSearchIndex(impl), []);
    assert.equal(calls.length, 1);
  });

  it("preloading never throws, even when the download fails", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      assert.doesNotThrow(() => preloadSearchIndex());
      // Let the rejected request settle (and its handlers run) before moving on.
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(peekSearchIndex(), null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("the slim index is searchable with the same matcher the dialog uses", () => {
    const hits = matchProducts([slim], "scrubs");
    assert.deepEqual(hits.map((hit) => hit.handle), ["scrub-top"]);
  });
});
