import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendEmail, sendTestEmail } from "@/lib/engagement/providers/email";
import { isIntegrationEnabled, maybeAutoEnableBrevo, setIntegrationEnabled } from "@/lib/integrations/enabled";
import { getIntegrationStatuses } from "@/lib/integrations/status";
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

// isProviderConfigured("BREVO") needs an API key AND a From Email (F-267 —
// Brevo rejects a sender it hasn't verified, so there's no default to
// invent), so this suite can exercise the "configured but not opted in" case
// without needing real Shopify credentials.
const BREVO_ENV = { BREVO_API_KEY: "test-key", BREVO_FROM_EMAIL: "orders@example.com" };

describe("isIntegrationEnabled defaults to disabled", () => {
  it("is disabled when the provider isn't configured at all", async () => {
    await withEnv({ BREVO_API_KEY: undefined, BREVO_FROM_EMAIL: undefined }, async () => {
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });

  it("is disabled when configured but no admin has opted in yet", async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
    await withEnv(BREVO_ENV, async () => {
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });

  it("is enabled once an admin explicitly turns it on", async () => {
    await withEnv(BREVO_ENV, async () => {
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

describe("Brevo needs a From Email to count as configured (F-267)", () => {
  beforeEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
  });

  it("an API key alone is 'missing', with a hint that says what to add — even with the toggle on", async () => {
    await setIntegrationEnabled("BREVO", true);
    await withEnv({ BREVO_API_KEY: "test-key", BREVO_FROM_EMAIL: undefined }, async () => {
      const brevo = (await getIntegrationStatuses()).find((item) => item.provider === "BREVO");
      assert.equal(brevo?.status, "missing");
      assert.match(brevo?.hint ?? "", /From Email/);
      assert.equal(brevo?.source, undefined);
      assert.equal(await isIntegrationEnabled("BREVO"), false);
    });
  });

  it("a From Email alone, without a key, is still missing", async () => {
    await withEnv({ BREVO_API_KEY: undefined, BREVO_FROM_EMAIL: "orders@example.com" }, async () => {
      const brevo = (await getIntegrationStatuses()).find((item) => item.provider === "BREVO");
      assert.equal(brevo?.status, "missing");
      assert.equal(brevo?.hint, "Transactional and campaign email");
    });
  });

  it("both together are configured, and report where the key came from", async () => {
    await withEnv(BREVO_ENV, async () => {
      const brevo = (await getIntegrationStatuses()).find((item) => item.provider === "BREVO");
      assert.equal(brevo?.status, "configured");
      assert.equal(brevo?.source, "env");
    });
  });
});

describe("sendEmail vs the admin test send (F-267)", () => {
  const realFetch = globalThis.fetch;
  let brevoCalls: { url: string; body: { sender: { email: string } } }[] = [];

  beforeEach(async () => {
    await db.integrationSetting.deleteMany({ where: { provider: "BREVO" } });
    brevoCalls = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      brevoCalls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ messageId: "test-message-id" }), { status: 201 });
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  const message = { to: "owner@example.com", subject: "Test", html: "<p>hi</p>" };

  it("the real send stays off while the toggle is off, but the test send works so the owner can check first", async () => {
    await withEnv(BREVO_ENV, async () => {
      const real = await sendEmail(message);
      assert.equal(real.ok, false);
      assert.equal(real.provider, "stub");
      assert.equal(brevoCalls.length, 0, "no call to Brevo while the provider is disabled");

      const test = await sendTestEmail(message);
      assert.equal(test.ok, true);
      assert.equal(test.provider, "brevo");
      assert.equal(brevoCalls.length, 1);
      assert.equal(brevoCalls[0].body.sender.email, "orders@example.com", "sent from the saved From Email");
    });
  });

  it("neither sends without a From Email — there is no invented fallback sender", async () => {
    await setIntegrationEnabled("BREVO", true);
    await withEnv({ BREVO_API_KEY: "test-key", BREVO_FROM_EMAIL: undefined }, async () => {
      const real = await sendEmail(message);
      assert.equal(real.ok, false);
      const test = await sendTestEmail(message);
      assert.equal(test.ok, false);
      assert.match(test.error ?? "", /From Email/);
      assert.equal(brevoCalls.length, 0);
    });
  });

  it("the real send goes out once the toggle is on", async () => {
    await setIntegrationEnabled("BREVO", true);
    await withEnv(BREVO_ENV, async () => {
      const real = await sendEmail(message);
      assert.equal(real.ok, true);
      assert.equal(brevoCalls.length, 1);
    });
  });
});
