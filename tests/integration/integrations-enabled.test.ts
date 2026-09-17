import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { isIntegrationEnabled, setIntegrationEnabled } from "@/lib/integrations/enabled";
import { db } from "@/lib/db";
import { withEnv } from "../helpers/env";

// isProviderConfigured("BREVO") only requires BREVO_API_KEY, so this
// suite can exercise the "configured but not opted in" case without
// needing real Shopify credentials.
describe("isIntegrationEnabled defaults to disabled", () => {
  after(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
  });

  it("is disabled when the provider isn't configured at all", async () => {
    await withEnv({ BREVO_API_KEY: undefined }, async () => {
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });

  it("is disabled when configured but no admin has opted in yet", async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
    await withEnv({ BREVO_API_KEY: "test-key" }, async () => {
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });

  it("is enabled once an admin explicitly turns it on", async () => {
    await withEnv({ BREVO_API_KEY: "test-key" }, async () => {
      await setIntegrationEnabled("BREVO", true);
      assert.equal(await isIntegrationEnabled("BREVO"), true);

      await setIntegrationEnabled("BREVO", false);
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });
});
