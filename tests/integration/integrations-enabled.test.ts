import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIntegrationEnabled, maybeAutoEnableBrevo, setIntegrationEnabled } from "@/lib/integrations/enabled";
import { db } from "@/lib/db";
import { withEnv } from "../helpers/env";
import { stashIntegrationState } from "../helpers/integration-state";

// This suite resets the Brevo integration row between cases and assumes no
// Brevo key is stored. The owner's real rows are set aside for the run and
// restored afterwards, so a run against a database with Brevo already
// switched on no longer turns it off (F-080).
let restoreIntegrationState: (() => Promise<void>) | undefined;

before(async () => {
  restoreIntegrationState = await stashIntegrationState({ credentialProviders: ["BREVO"], settingProviders: ["BREVO"] });
});

after(async () => {
  await restoreIntegrationState?.();
});

// isProviderConfigured("BREVO") only requires BREVO_API_KEY, so this
// suite can exercise the "configured but not opted in" case without
// needing real Shopify credentials.
describe("isIntegrationEnabled defaults to disabled", () => {
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

describe("maybeAutoEnableBrevo (F-267)", () => {
  beforeEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
  });

  it("does nothing when the other credential still isn't configured", async () => {
    const enabled = await maybeAutoEnableBrevo({ wasAlreadyConfigured: false, otherFieldConfigured: false });
    assert.equal(enabled, false);
    assert.equal((await db.integrationSetting.findUnique({ where: { provider: "BREVO" } }))?.enabled, undefined);
  });

  it("turns Brevo on the first time both credentials become present", async () => {
    const enabled = await maybeAutoEnableBrevo({ wasAlreadyConfigured: false, otherFieldConfigured: true });
    assert.equal(enabled, true);
    assert.equal((await db.integrationSetting.findUnique({ where: { provider: "BREVO" } }))?.enabled, true);
  });

  it("does NOT re-enable when the credential being saved was already configured (e.g. fixing a typo)", async () => {
    // Simulate an admin who had it configured, then deliberately disabled it.
    await setIntegrationEnabled("BREVO", true);
    await setIntegrationEnabled("BREVO", false);

    const enabled = await maybeAutoEnableBrevo({ wasAlreadyConfigured: true, otherFieldConfigured: true });
    assert.equal(enabled, false);
    assert.equal((await db.integrationSetting.findUnique({ where: { provider: "BREVO" } }))?.enabled, false);
  });

  it("is a no-op when already enabled", async () => {
    await setIntegrationEnabled("BREVO", true);
    const enabled = await maybeAutoEnableBrevo({ wasAlreadyConfigured: false, otherFieldConfigured: true });
    assert.equal(enabled, false);
  });
});
