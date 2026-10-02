import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSealedBody, openOutboxBody, REDACTED_BODY, sealOutboxBody } from "@/lib/engagement/outbox-seal";
import { withEnv } from "../../../tests/helpers/env";

/**
 * F-043: credential-bearing outbox bodies (reset / verify / newsletter
 * confirm / order-access links) are sealed at rest. Pure crypto, no DB.
 */

const SECRET_A = "outbox-seal-test-secret-A-0123456789abcdef";
const SECRET_B = "outbox-seal-test-secret-B-0123456789abcdef";
const RAW_TOKEN = "rawResetTokenValue-9f8e7d6c5b4a";
const body = {
  html: `<a href="https://example.test/account/reset-password?token=${RAW_TOKEN}">Reset</a>`,
  text: `Reset: https://example.test/account/reset-password?token=${RAW_TOKEN}`,
};

describe("outbox body sealing (F-043)", () => {
  it("round-trips a body and never leaves the raw token readable in the stored value", async () => {
    await withEnv({ AUTH_SECRET: SECRET_A }, () => {
      const stored = sealOutboxBody(body);
      assert.ok(isSealedBody(stored));
      assert.ok(!stored.includes(RAW_TOKEN), "the stored value must not contain the token");
      assert.ok(!stored.includes("reset-password"), "nor any part of the link");
      assert.deepEqual(openOutboxBody(stored, null), body);
    });
  });

  it("seals the same body to a different value each time (random IV)", async () => {
    await withEnv({ AUTH_SECRET: SECRET_A }, () => {
      assert.notEqual(sealOutboxBody(body), sealOutboxBody(body));
    });
  });

  it("cannot be opened with a different AUTH_SECRET — returns null instead of throwing", async () => {
    let stored = "";
    await withEnv({ AUTH_SECRET: SECRET_A }, () => {
      stored = sealOutboxBody(body);
    });
    await withEnv({ AUTH_SECRET: SECRET_B }, () => {
      assert.equal(openOutboxBody(stored, null), null);
    });
  });

  it("detects tampering with the stored value", async () => {
    await withEnv({ AUTH_SECRET: SECRET_A }, () => {
      const stored = sealOutboxBody(body);
      const flipped = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
      assert.equal(openOutboxBody(flipped, null), null);
      assert.equal(openOutboxBody("sealed:v1:not-base64-at-all!!", null), null);
    });
  });

  it("passes an unsealed (legacy or non-credential) body through unchanged", () => {
    assert.deepEqual(openOutboxBody("<p>plain</p>", "plain"), { html: "<p>plain</p>", text: "plain" });
    assert.equal(isSealedBody("<p>plain</p>"), false);
  });

  it("fails closed when AUTH_SECRET is missing — it will not store a credential in the clear", async () => {
    await withEnv({ AUTH_SECRET: undefined }, () => {
      assert.throws(() => sealOutboxBody(body), /AUTH_SECRET/);
    });
  });

  it("exposes a fixed placeholder for redacted bodies that contains no credential", () => {
    assert.equal(REDACTED_BODY, "[body redacted]");
    assert.equal(isSealedBody(REDACTED_BODY), false);
  });
});
