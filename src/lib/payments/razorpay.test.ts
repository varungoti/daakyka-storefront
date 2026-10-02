import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  capturedPaymentMatchesOrder,
  fetchCapturedPaymentId,
  isRazorpayConfigured,
  setRazorpayClientForTesting,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay";
import { findAnyAdminId } from "../../../tests/helpers/admin-user";
import { TEST_CREDENTIAL_KEY } from "../../../tests/helpers/credential-key";
import { withEnv } from "../../../tests/helpers/env";
import { stashIntegrationState } from "../../../tests/helpers/integration-state";

const TEST_KEY_SECRET = "test-razorpay-key-secret";
const TEST_WEBHOOK_SECRET = "test-razorpay-webhook-secret";

describe("capturedPaymentMatchesOrder", () => {
  it("requires the provider payment to match id, order, capture, amount and currency", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      let amount = 25000;
      setRazorpayClientForTesting({
        orders: { create: async () => { throw new Error("not used"); } },
        payments: { fetch: async (id) => ({ id, order_id: "order_x", status: "captured", amount, currency: "INR" }) },
      });
      try {
        assert.equal(await capturedPaymentMatchesOrder("pay_x", "order_x", 25000, "INR"), true);
        amount = 24900;
        assert.equal(await capturedPaymentMatchesOrder("pay_x", "order_x", 25000, "INR"), false);
      } finally {
        setRazorpayClientForTesting(null);
      }
    });
  });
});

describe("isRazorpayConfigured", () => {
  it("is false when either key is missing", async () => {
    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
      assert.equal(await isRazorpayConfigured(), false);
    });
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: undefined }, async () => {
      assert.equal(await isRazorpayConfigured(), false);
    });
  });

  it("is true when both keys are set", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }, async () => {
      assert.equal(await isRazorpayConfigured(), true);
    });
  });
});

describe("verifyPaymentSignature", () => {
  it("accepts a signature computed the way Razorpay Checkout.js does", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const orderId = "order_test123";
      const paymentId = "pay_test456";
      const validSignature = createHmac("sha256", TEST_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      assert.equal(await verifyPaymentSignature(orderId, paymentId, validSignature), true);
    });
  });

  it("rejects a tampered signature", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const orderId = "order_test123";
      const paymentId = "pay_test456";
      const validSignature = createHmac("sha256", TEST_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
      const tampered = `${validSignature.slice(0, -1)}${validSignature.at(-1) === "0" ? "1" : "0"}`;

      assert.equal(await verifyPaymentSignature(orderId, paymentId, tampered), false);
    });
  });

  it("rejects a signature computed for a different order/payment id", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const signatureForOther = createHmac("sha256", TEST_KEY_SECRET)
        .update("order_other|pay_other")
        .digest("hex");

      assert.equal(
        await verifyPaymentSignature("order_test123", "pay_test456", signatureForOther),
        false,
      );
    });
  });

  it("returns false when RAZORPAY_KEY_SECRET is unset", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: undefined }, async () => {
      assert.equal(await verifyPaymentSignature("order_1", "pay_1", "anything"), false);
    });
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a signature computed over the exact raw body", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const rawBody = JSON.stringify({ event: "payment.captured", payload: {} });
      const validSignature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");

      assert.equal(await verifyWebhookSignature(rawBody, validSignature), true);
    });
  });

  it("rejects a tampered body against a signature computed for the original", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const rawBody = JSON.stringify({ event: "payment.captured", payload: {} });
      const validSignature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
      const tamperedBody = JSON.stringify({ event: "payment.captured", payload: { hacked: true } });

      assert.equal(await verifyWebhookSignature(tamperedBody, validSignature), false);
    });
  });

  it("rejects a missing signature header", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      assert.equal(await verifyWebhookSignature("{}", null), false);
    });
  });

  it("returns false when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined }, async () => {
      assert.equal(await verifyWebhookSignature("{}", "somesignature"), false);
    });
  });
});

// F-225 fix (release-hardening order-lifecycle-payment-integrity): the
// stale-order cron's reconciliation check.
describe("fetchCapturedPaymentId", () => {
  after(() => setRazorpayClientForTesting(null));

  it("returns null (not configured) without ever calling the client", async () => {
    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
      let called = false;
      setRazorpayClientForTesting({
        orders: {
          create: async () => {
            called = true;
            throw new Error("should never be called");
          },
          fetchPayments: async () => {
            called = true;
            return { items: [] };
          },
        },
      });
      assert.equal(await fetchCapturedPaymentId("order_x"), null);
      assert.equal(called, false);
    });
  });

  it("returns the captured payment's id when one exists", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }, async () => {
      setRazorpayClientForTesting({
        orders: {
          create: async () => {
            throw new Error("not exercised by this test");
          },
          fetchPayments: async (orderId) => {
            assert.equal(orderId, "order_x");
            return {
              items: [
                { id: "pay_failed_1", status: "failed" },
                { id: "pay_captured_1", status: "captured" },
              ],
            };
          },
        },
      });
      assert.equal(await fetchCapturedPaymentId("order_x"), "pay_captured_1");
    });
  });

  it("returns null when nothing on the order was captured", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }, async () => {
      setRazorpayClientForTesting({
        orders: {
          create: async () => {
            throw new Error("not exercised by this test");
          },
          fetchPayments: async () => ({ items: [{ id: "pay_failed_1", status: "failed" }] }),
        },
      });
      assert.equal(await fetchCapturedPaymentId("order_x"), null);
    });
  });

  it("propagates a Razorpay API failure rather than reporting 'nothing captured'", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }, async () => {
      setRazorpayClientForTesting({
        orders: {
          create: async () => {
            throw new Error("not exercised by this test");
          },
          fetchPayments: async () => {
            throw new Error("Razorpay API unreachable");
          },
        },
      });
      await assert.rejects(() => fetchCapturedPaymentId("order_x"), /unreachable/);
    });
  });
});

describe("DB-backed credentials take priority over env vars", () => {
  it("isRazorpayConfigured prefers a DB-set key id/secret over env", async () => {
    // A clean CI runner has no .env to supply CREDENTIAL_ENCRYPTION_KEY, so
    // the test brings its own (F-249); a developer's key is kept as is.
    await withEnv(
      {
        RAZORPAY_KEY_ID: undefined,
        RAZORPAY_KEY_SECRET: undefined,
        CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY || TEST_CREDENTIAL_KEY,
      },
      async () => {
        const { setCredential, clearCredential } = await import("@/lib/integrations/credential-store");
        const adminId = await findAnyAdminId();

        // Set any real Razorpay keys aside for the run and restore them
        // after, rather than overwriting then deleting them (F-080).
        const restoreIntegrationState = await stashIntegrationState({ credentialProviders: ["RAZORPAY"] });
        try {
          await setCredential("RAZORPAY", "KEY_ID", "rzp_db_test", adminId);
          await setCredential("RAZORPAY", "KEY_SECRET", "db-secret", adminId);
          assert.equal(await isRazorpayConfigured(), true);

          await clearCredential("RAZORPAY", "KEY_ID", adminId);
          await clearCredential("RAZORPAY", "KEY_SECRET", adminId);
          assert.equal(await isRazorpayConfigured(), false);
        } finally {
          await restoreIntegrationState();
        }
      },
    );
  });
});
