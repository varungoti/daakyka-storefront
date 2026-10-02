import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAbandonBeacon,
  buildLocalCart,
  createLocalCartId,
  isLocalCartId,
  isShopifyCartMode,
  isUniqueLocalCartId,
} from "@/lib/cart/service";
import type { CartLine } from "@/lib/types";
import { withEnv } from "../../../tests/helpers/env";

/**
 * F-231 (release-hardening audit): isShopifyCartMode() used to return
 * isShopifyConfigured(), so following the old SHOPIFY_SETUP.md and
 * setting NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN + NEXT_PUBLIC_SHOPIFY_
 * STOREFRONT_ACCESS_TOKEN flipped every cart into "shopify" mode, which
 * POSTs to /api/cart — a route deleted in fbfa68b — breaking add-to-cart
 * site-wide. It's hard-coded false now: no combination of env vars can
 * re-enable a cart mode that talks to a route that no longer exists.
 */
describe("isShopifyCartMode", () => {
  it("is false with no Shopify env vars set", async () => {
    await withEnv(
      {
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: undefined,
        NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined,
      },
      () => {
        assert.equal(isShopifyCartMode(), false);
      },
    );
  });

  it("stays false even when both Shopify Storefront env vars are set", async () => {
    await withEnv(
      {
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
        NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: "shpat_test_token",
      },
      () => {
        assert.equal(isShopifyCartMode(), false);
      },
    );
  });
});

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: "local-line-v1",
    variantId: "v1",
    productHandle: "scrub-top",
    productTitle: "Scrub Top",
    variantTitle: "M / Navy",
    quantity: 2,
    price: 899,
    image: "/img.jpg",
    ...overrides,
  };
}

/**
 * F-122: buildLocalCart hard-coded `id: "local-cart"` for every cart, so
 * the abandoned-cart beacon (deduped per cartId for an hour) recorded at
 * most one abandonment per hour for the entire store.
 */
describe("per-cart ids (F-122)", () => {
  it("createLocalCartId mints a distinct, recognisable id every time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createLocalCartId()));
    assert.equal(ids.size, 50);
    for (const id of ids) {
      assert.ok(isLocalCartId(id));
      assert.ok(isUniqueLocalCartId(id), id);
    }
  });

  it("isUniqueLocalCartId rejects the retired shared sentinel and arbitrary strings", () => {
    assert.equal(isUniqueLocalCartId("local-cart"), false);
    assert.equal(isUniqueLocalCartId(""), false);
    assert.equal(isUniqueLocalCartId("local-"), false);
    assert.equal(isUniqueLocalCartId("gid://shopify/Cart/abc"), false);
    assert.equal(isUniqueLocalCartId("anything-at-all"), false);
  });

  it("buildLocalCart carries the id it is given instead of a shared constant", () => {
    const a = buildLocalCart([line()], createLocalCartId());
    const b = buildLocalCart([line()], createLocalCartId());
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.id, "local-cart");
    assert.equal(buildLocalCart([line()], "local-123").id, "local-123");
  });

  it("buildLocalCart totals its lines", () => {
    const cart = buildLocalCart([line(), line({ id: "l2", variantId: "v2", quantity: 1, price: 100 })], "local-x");
    assert.equal(cart.totalQuantity, 3);
    assert.equal(cart.subtotal, 899 * 2 + 100);
    assert.equal(cart.currencyCode, "INR");
  });
});

describe("buildAbandonBeacon (F-122)", () => {
  it("builds a per-cart payload with no email in it (F-072)", () => {
    const id = createLocalCartId();
    const cart = buildLocalCart([line()], id);
    const beacon = buildAbandonBeacon(cart, id);
    assert.ok(beacon);
    const body = JSON.parse(beacon!.payload);
    assert.equal(body.cartId, id);
    assert.equal(body.itemCount, 2);
    assert.equal(body.subtotal, 1798);
    assert.deepEqual(body.items, [{ title: "Scrub Top", quantity: 2 }]);
    assert.ok(!("email" in body));
  });

  it("gives two different shoppers' identical carts different cart ids and fingerprints", () => {
    const idA = createLocalCartId();
    const idB = createLocalCartId();
    const a = buildAbandonBeacon(buildLocalCart([line()], idA), idA);
    const b = buildAbandonBeacon(buildLocalCart([line()], idB), idB);
    assert.notEqual(JSON.parse(a!.payload).cartId, JSON.parse(b!.payload).cartId);
    assert.notEqual(a!.fingerprint, b!.fingerprint);
  });

  it("changes the fingerprint when the same cart changes, so a changed cart is re-reported", () => {
    const id = createLocalCartId();
    const one = buildAbandonBeacon(buildLocalCart([line({ quantity: 1 })], id), id);
    const two = buildAbandonBeacon(buildLocalCart([line({ quantity: 2 })], id), id);
    assert.notEqual(one!.fingerprint, two!.fingerprint);
  });

  it("sends nothing for an empty cart, or without a real per-cart id (never the shared sentinel)", () => {
    const id = createLocalCartId();
    assert.equal(buildAbandonBeacon(buildLocalCart([], id), id), null);
    assert.equal(buildAbandonBeacon(buildLocalCart([line()], "local-cart"), "local-cart"), null);
    assert.equal(buildAbandonBeacon(buildLocalCart([line()], id), ""), null);
  });
});
