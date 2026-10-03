import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { getIntegrationStatuses, isProviderConfigured } from "@/lib/integrations/status";
import { withEnv } from "../../../tests/helpers/env";

// The SHOPIFY card used to read "Shopify Storefront — Product catalog and
// checkout" and was keyed off the NEXT_PUBLIC_SHOPIFY_* Storefront API
// vars, but there is no Shopify-backed catalog, cart or checkout any more
// (isShopifyCartMode() is hard-coded false; checkout is Razorpay + the
// Prisma catalog). The only Shopify code left is the optional orders
// webhook, which depends on SHOPIFY_WEBHOOK_SECRET alone.
//
// getIntegrationStatuses() also resolves Brevo/Razorpay credentials from
// the DB. Stub that read so these tests never touch whatever database
// DATABASE_URL happens to point at.
const originalFindUnique = db.integrationCredential.findUnique;
before(() => {
  // @ts-expect-error - stubbing a Prisma delegate method for the test only.
  db.integrationCredential.findUnique = async () => null;
});
after(() => {
  db.integrationCredential.findUnique = originalFindUnique;
});

const STOREFRONT_VARS = {
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
  NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: "storefront-token",
};

async function shopifyStatus() {
  const entry = (await getIntegrationStatuses()).find((item) => item.provider === "SHOPIFY");
  assert.ok(entry, "expected a SHOPIFY status entry");
  return entry;
}

describe("getIntegrationStatuses SHOPIFY entry", () => {
  it("describes the orders webhook, not a catalog/checkout integration", async () => {
    const entry = await shopifyStatus();
    assert.equal(entry.label, "Shopify Orders Webhook");
    assert.equal(entry.hint, "Import orders from an existing Shopify store");
    assert.doesNotMatch(`${entry.label} ${entry.hint}`, /storefront|catalog|checkout/i);
  });

  it("is configured when SHOPIFY_WEBHOOK_SECRET is set, even without the Storefront API vars", async () => {
    await withEnv(
      {
        SHOPIFY_WEBHOOK_SECRET: "whsec",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: undefined,
        NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined,
      },
      async () => {
        assert.equal((await shopifyStatus()).status, "configured");
        assert.equal(await isProviderConfigured("SHOPIFY"), true);
      },
    );
  });

  it("is missing when only the Storefront API vars are set", async () => {
    await withEnv({ SHOPIFY_WEBHOOK_SECRET: undefined, ...STOREFRONT_VARS }, async () => {
      assert.equal((await shopifyStatus()).status, "missing");
      assert.equal(await isProviderConfigured("SHOPIFY"), false);
    });
  });
});
