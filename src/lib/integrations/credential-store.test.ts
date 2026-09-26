import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import {
  CREDENTIAL_FIELDS,
  CREDENTIALS_CACHE_REVALIDATE_PROFILE,
  decrypt,
  encrypt,
  getCredential,
  isCredentialKey,
  validateCredentialFormat,
} from "@/lib/integrations/credential-store";
import { withEnv } from "../../../tests/helpers/env";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_KEY_HEX = Buffer.alloc(32, 9).toString("hex");

describe("encrypt/decrypt round trip", () => {
  it("decrypts back to the original plaintext", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: TEST_KEY }, () => {
      const ciphertext = encrypt("rzp_live_super_secret");
      assert.equal(decrypt(ciphertext), "rzp_live_super_secret");
    });
  });

  it("accepts a hex-encoded 32-byte key as well as base64", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: TEST_KEY_HEX }, () => {
      const ciphertext = encrypt("hex-key-secret");
      assert.equal(decrypt(ciphertext), "hex-key-secret");
    });
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: TEST_KEY }, () => {
      const first = encrypt("same-value");
      const second = encrypt("same-value");
      assert.notEqual(first, second);
      assert.equal(decrypt(first), "same-value");
      assert.equal(decrypt(second), "same-value");
    });
  });

  it("throws when CREDENTIAL_ENCRYPTION_KEY is not set", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: undefined }, () => {
      assert.throws(() => encrypt("anything"), /CREDENTIAL_ENCRYPTION_KEY is not set/);
    });
  });

  it("throws when CREDENTIAL_ENCRYPTION_KEY does not decode to 32 bytes", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: Buffer.from("too-short").toString("base64") }, () => {
      assert.throws(() => encrypt("anything"), /32 bytes/);
    });
  });

  it("fails to decrypt a tampered ciphertext (GCM auth tag mismatch)", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: TEST_KEY }, () => {
      const ciphertext = encrypt("do-not-tamper");
      const [iv, authTag, body] = ciphertext.split(".");
      const tamperedBody = Buffer.from(body, "base64");
      tamperedBody[0] ^= 0xff;
      const tampered = [iv, authTag, tamperedBody.toString("base64")].join(".");
      assert.throws(() => decrypt(tampered));
    });
  });

  it("rejects a malformed payload", async () => {
    await withEnv({ CREDENTIAL_ENCRYPTION_KEY: TEST_KEY }, () => {
      assert.throws(() => decrypt("not-a-valid-payload"), /Malformed encrypted credential payload/);
    });
  });
});

describe("CREDENTIAL_FIELDS / isCredentialKey", () => {
  it("defines the expected fields per provider", () => {
    assert.deepEqual(
      CREDENTIAL_FIELDS.RAZORPAY.map((f) => f.key),
      ["KEY_ID", "KEY_SECRET", "WEBHOOK_SECRET"],
    );
    assert.deepEqual(CREDENTIAL_FIELDS.BREVO.map((f) => f.key), ["API_KEY", "FROM_EMAIL"]);
  });

  it("marks every Razorpay field and the Brevo API key as secret, but not FROM_EMAIL", () => {
    for (const field of CREDENTIAL_FIELDS.RAZORPAY) {
      assert.equal(field.secret, true, `${field.key} should be secret`);
    }
    assert.equal(CREDENTIAL_FIELDS.BREVO.find((f) => f.key === "API_KEY")?.secret, true);
    assert.equal(CREDENTIAL_FIELDS.BREVO.find((f) => f.key === "FROM_EMAIL")?.secret, false);
  });

  it("accepts known keys and rejects unknown ones", () => {
    assert.equal(isCredentialKey("RAZORPAY", "KEY_ID"), true);
    assert.equal(isCredentialKey("RAZORPAY", "API_KEY"), false);
    assert.equal(isCredentialKey("BREVO", "FROM_EMAIL"), true);
    assert.equal(isCredentialKey("BREVO", "WEBHOOK_SECRET"), false);
  });
});

// F-215: unstable_cache/revalidateTag only do anything inside a real
// Next.js request, so a plain `tsx --test` run can never exercise the
// actual stale-vs-fresh cache behavior end to end (see getCredential's
// resilience test below, and integration-credentials.test.ts's round trip —
// both always take the uncached fallback path in this harness). This pins
// the one part of the fix that *is* directly testable here: the cache is
// invalidated with a profile that never serves stale data. "max" (the
// pre-fix value) means the opposite — see the doc comment on
// invalidateCredentialsCache in credential-store.ts.
describe("credentials cache invalidation profile (F-215)", () => {
  it("never serves stale data after a save/clear", () => {
    assert.deepEqual(CREDENTIALS_CACHE_REVALIDATE_PROFILE, { expire: 0 });
  });
});

describe("validateCredentialFormat (F-215)", () => {
  it("accepts a well-formed Razorpay test/live Key ID and rejects garbage", () => {
    assert.equal(validateCredentialFormat("RAZORPAY", "KEY_ID", "rzp_test_1DP5mmOlF5G5ag"), null);
    assert.equal(validateCredentialFormat("RAZORPAY", "KEY_ID", "rzp_live_1DP5mmOlF5G5ag"), null);
    assert.match(
      validateCredentialFormat("RAZORPAY", "KEY_ID", "not-a-razorpay-key") ?? "",
      /rzp_test_|rzp_live_/,
    );
  });

  it("doesn't format-check the Razorpay Key Secret or Webhook Secret (opaque provider strings)", () => {
    assert.equal(validateCredentialFormat("RAZORPAY", "KEY_SECRET", "anything-goes-here"), null);
    assert.equal(validateCredentialFormat("RAZORPAY", "WEBHOOK_SECRET", "anything-goes-here"), null);
  });

  it("accepts a well-formed Brevo API key and rejects one missing the xkeysib- prefix", () => {
    assert.equal(validateCredentialFormat("BREVO", "API_KEY", "xkeysib-abc123"), null);
    assert.match(validateCredentialFormat("BREVO", "API_KEY", "sk-not-a-brevo-key") ?? "", /xkeysib-/);
  });

  it("accepts a valid Brevo FROM_EMAIL and rejects a non-email value", () => {
    assert.equal(validateCredentialFormat("BREVO", "FROM_EMAIL", "orders@daakyka.com"), null);
    assert.match(
      validateCredentialFormat("BREVO", "FROM_EMAIL", "not-an-email") ?? "",
      /valid email/,
    );
  });
});

// F-222: a DB (or decrypt) error used to be caught *inside* the function
// unstable_cache wraps, so the resulting `null` got cached as "not set in
// the DB" for up to a year — which can silently turn Razorpay off
// (isRazorpayConfigured() sees null with no env fallback) or freeze a
// stale Brevo key. It's now caught only outside the cache boundary, so a
// failed read never poisons the cache. As in settings/index.test.ts, this
// can't reach the real unstable_cache path under plain `tsx --test` (no
// Next request/build store) — getCredential's own uncached fallback branch
// is what runs here — but it proves the read never throws to the caller
// and never leaves a poisoned result behind for the next read.
describe("getCredential resilience to a transient DB error", () => {
  it("falls back to null without throwing, then reflects the DB again once it recovers", async () => {
    const original = db.integrationCredential.findUnique;
    let calls = 0;
    // @ts-expect-error - stubbing a Prisma delegate method for the test only.
    db.integrationCredential.findUnique = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("simulated transient DB error (connection terminated unexpectedly)");
      }
      return null;
    };

    try {
      const duringOutage = await getCredential("RAZORPAY", "KEY_ID");
      assert.equal(duringOutage, null);

      const afterRecovery = await getCredential("RAZORPAY", "KEY_ID");
      assert.equal(afterRecovery, null);
      assert.equal(calls, 2, "the second read must hit the DB again, not repeat a cached failure");
    } finally {
      db.integrationCredential.findUnique = original;
    }
  });
});
