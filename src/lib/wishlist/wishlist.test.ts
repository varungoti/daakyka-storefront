import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStoredWishlist, toggleWishlistEntry } from "@/lib/wishlist/entries";
import { nameFromHandle, resolveWishlist } from "@/lib/wishlist/live-products";
import { loadSearchIndex, peekSearchIndex, refreshSearchIndex, resetSearchIndexForTests } from "@/lib/search/search-index";
import type { SearchProduct } from "@/lib/products/public-search-product";

/**
 * F-113: the wishlist used to save the whole Product (~5 KB with every variant
 * and the description) and render its price, photo and name from that copy, so
 * a price change never showed up ("₹499" in the drawer while the product page
 * said ₹899) and an archived product stayed listed and linked to a 404. It now
 * saves `{ id, handle }` and reads everything else from the live catalogue.
 */

const live = (overrides: Partial<SearchProduct> & { id: string; handle: string }): SearchProduct => ({
  name: "Women's V-Neck Scrub Top",
  colorName: "Wine",
  price: 899,
  image: "/cdn/media/product/wine.webp",
  category: "tops",
  fabricTech: [],
  colors: [{ name: "Wine" }],
  ...overrides,
});

describe("normalizeStoredWishlist (F-113)", () => {
  // The shape the old store wrote: a whole product per item.
  const legacySnapshot = {
    id: "p1",
    handle: "womens-vneck-scrub-top",
    name: "Women's V-Neck Scrub Top",
    colorName: "Wine",
    price: 499,
    description: "x".repeat(2000),
    variants: Array.from({ length: 15 }, (_, i) => ({ id: `v${i}`, stock: 20 })),
  };

  it("keeps only the id and handle of a product saved in the old full-snapshot format, and reports the change", () => {
    const { items, changed } = normalizeStoredWishlist([legacySnapshot]);
    assert.deepEqual(items, [{ id: "p1", handle: "womens-vneck-scrub-top" }]);
    assert.equal(changed, true, "the migrated form has to be written back");
    assert.equal(JSON.stringify(items).includes("499"), false, "the stale price must not survive");
  });

  it("leaves an already-slim list alone", () => {
    const slim = [
      { id: "p1", handle: "a" },
      { id: "p2", handle: "b" },
    ];
    const result = normalizeStoredWishlist(slim);
    assert.deepEqual(result.items, slim);
    assert.equal(result.changed, false);
  });

  it("skips entries without a usable id and handle, and keeps the first of a duplicate id", () => {
    const { items, changed } = normalizeStoredWishlist([
      { id: "p1", handle: "a" },
      { id: "p1", handle: "a-again" },
      { id: "", handle: "no-id" },
      { id: "p3" },
      "not an object",
      null,
      { id: 7, handle: "numeric-id" },
    ]);
    assert.deepEqual(items, [{ id: "p1", handle: "a" }]);
    assert.equal(changed, true);
  });

  it("treats anything that is not a list as empty", () => {
    assert.deepEqual(normalizeStoredWishlist({ id: "p1", handle: "a" }).items, []);
    assert.deepEqual(normalizeStoredWishlist("garbage").items, []);
    assert.deepEqual(normalizeStoredWishlist(null), { items: [], changed: false });
  });
});

describe("toggleWishlistEntry (F-113)", () => {
  it("saves only the id and handle of the full product the heart button holds", () => {
    const fullProduct = { id: "p1", handle: "scrub-top", price: 899, variants: [{ id: "v1" }], description: "long" };
    const next = toggleWishlistEntry([], fullProduct);
    assert.deepEqual(next, [{ id: "p1", handle: "scrub-top" }]);
    assert.ok(JSON.stringify(next).length < 60);
  });

  it("removes a product that is already saved, and leaves the others", () => {
    const current = [
      { id: "p1", handle: "a" },
      { id: "p2", handle: "b" },
    ];
    assert.deepEqual(toggleWishlistEntry(current, { id: "p1", handle: "a" }), [{ id: "p2", handle: "b" }]);
  });
});

describe("resolveWishlist (F-113)", () => {
  const entries = [
    { id: "p1", handle: "womens-vneck-scrub-top" },
    { id: "p2", handle: "draw-sheet" },
  ];

  it("shows the live price, not the one from the day the product was saved", () => {
    // The audit's repro: saved when it cost 499, the admin has since set 899.
    const { rows } = resolveWishlist(entries, [
      live({ id: "p1", handle: "womens-vneck-scrub-top", price: 899, compareAtPrice: 1199 }),
      live({ id: "p2", handle: "draw-sheet", price: 349, available: false }),
    ]);
    assert.equal(rows[0].product?.price, 899);
    assert.equal(rows[0].product?.compareAtPrice, 1199);
    assert.equal(rows[1].product?.available, false, "availability is live too");
  });

  it("keeps the saved order", () => {
    const { rows } = resolveWishlist(entries, [
      live({ id: "p2", handle: "draw-sheet" }),
      live({ id: "p1", handle: "womens-vneck-scrub-top" }),
    ]);
    assert.deepEqual(rows.map((row) => row.entry.id), ["p1", "p2"]);
  });

  it("reports a product the live catalogue no longer has, so it can be dropped", () => {
    const result = resolveWishlist(entries, [live({ id: "p1", handle: "womens-vneck-scrub-top" })]);
    assert.deepEqual(result.missingIds, ["p2"]);
    assert.equal(result.rows[1].product, null);
  });

  it("follows a product whose handle was renamed (matched by id) to its current address", () => {
    const { rows, missingIds } = resolveWishlist(entries, [
      live({ id: "p1", handle: "womens-v-neck-scrub-top" }),
      live({ id: "p2", handle: "draw-sheet" }),
    ]);
    assert.deepEqual(missingIds, []);
    assert.equal(rows[0].product?.handle, "womens-v-neck-scrub-top");
  });

  it("falls back to the handle when the id is not found", () => {
    const { rows, missingIds } = resolveWishlist([{ id: "old-id", handle: "draw-sheet" }], [
      live({ id: "p2", handle: "draw-sheet" }),
    ]);
    assert.deepEqual(missingIds, []);
    assert.equal(rows[0].product?.id, "p2");
  });

  it("never reports anything missing from an empty or unavailable catalogue (it must not wipe saved items)", () => {
    assert.deepEqual(resolveWishlist(entries, []).missingIds, []);
    assert.deepEqual(resolveWishlist(entries, null).missingIds, []);
    assert.deepEqual(
      resolveWishlist(entries, null).rows.map((row) => row.product),
      [null, null],
    );
  });

  it("does not expose anything beyond what the wishlist shows", () => {
    const { rows } = resolveWishlist([{ id: "p1", handle: "a" }], [
      live({ id: "p1", handle: "a", tags: ["scrubs"], fabricTech: ["anti-microbial"] as never }),
    ]);
    assert.deepEqual(Object.keys(rows[0].product ?? {}).sort(), [
      "available",
      "category",
      "colorName",
      "compareAtPrice",
      "handle",
      "id",
      "image",
      "name",
      "price",
    ]);
  });
});

describe("nameFromHandle", () => {
  it("makes a readable stand-in name for an entry the catalogue could not describe", () => {
    assert.equal(nameFromHandle("womens-vneck-scrub-top"), "Womens vneck scrub top");
    assert.equal(nameFromHandle("draw_sheet"), "Draw sheet");
  });
});

describe("search index refresh (F-113)", () => {
  afterEach(() => resetSearchIndexForTests());

  const respond = (products: SearchProduct[]) => async () => ({ ok: true, json: async () => ({ products }) });

  it("downloads again even though an earlier call cached the index, so a long-open tab sees a price change", async () => {
    let calls = 0;
    const first = live({ id: "p1", handle: "a", price: 499 });
    const second = live({ id: "p1", handle: "a", price: 899 });
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ products: [calls === 1 ? first : second] }) };
    };

    assert.equal((await loadSearchIndex(fetchImpl))[0].price, 499);
    assert.equal((await loadSearchIndex(fetchImpl))[0].price, 499, "a plain load reuses the cached copy");
    assert.equal(calls, 1);

    assert.equal((await refreshSearchIndex(fetchImpl))[0].price, 899);
    assert.equal(calls, 2);
    assert.equal(peekSearchIndex()?.[0].price, 899, "the fresh copy replaces the cached one");
  });

  it("shares one request between callers that ask at the same time", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return respond([live({ id: "p1", handle: "a" })])();
    };
    await Promise.all([refreshSearchIndex(fetchImpl), refreshSearchIndex(fetchImpl), loadSearchIndex(fetchImpl)]);
    assert.equal(calls, 1);
  });

  it("keeps the earlier copy when a refresh fails, and rejects so the caller can say so", async () => {
    await loadSearchIndex(respond([live({ id: "p1", handle: "a", price: 499 })]));
    await assert.rejects(refreshSearchIndex(async () => ({ ok: false, json: async () => ({}) })));
    assert.equal(peekSearchIndex()?.[0].price, 499);
  });
});

/**
 * The browser store itself — runs against a stand-in `window.localStorage`
 * installed before the module is first read, since the store hydrates once.
 */
describe("wishlist store migration (F-113)", () => {
  it("rewrites a list saved in the old format as ids and handles only, so the stale snapshot is not kept", async () => {
    const written = new Map<string, string>();
    const legacy = JSON.stringify([
      { id: "p1", handle: "womens-vneck-scrub-top", name: "Scrub Top", price: 499, variants: [{ id: "v1", stock: 3 }] },
    ]);
    written.set("daakyka-wishlist", legacy);
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => written.get(key) ?? null,
        setItem: (key: string, value: string) => void written.set(key, value),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as { window?: unknown }).window = fakeWindow;
    try {
      const store = await import("@/context/wishlist-store");
      const items = store.getWishlistSnapshot();
      assert.deepEqual(items, [{ id: "p1", handle: "womens-vneck-scrub-top" }]);

      const stored = written.get("daakyka-wishlist") ?? "";
      assert.deepEqual(JSON.parse(stored), [{ id: "p1", handle: "womens-vneck-scrub-top" }]);
      assert.equal(stored.includes("499"), false, "the old price must be gone from storage");
      assert.ok(stored.length < legacy.length / 2);

      store.setWishlistItems((current) => toggleWishlistEntry(current, { id: "p2", handle: "draw-sheet" }));
      assert.deepEqual(JSON.parse(written.get("daakyka-wishlist") ?? "[]"), [
        { id: "p1", handle: "womens-vneck-scrub-top" },
        { id: "p2", handle: "draw-sheet" },
      ]);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
