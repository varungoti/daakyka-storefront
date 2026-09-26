import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isShopifyCartMode } from "@/lib/cart/service";
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
