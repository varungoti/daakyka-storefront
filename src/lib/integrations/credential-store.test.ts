import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CREDENTIAL_FIELDS,
  decrypt,
  encrypt,
  isCredentialKey,
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
