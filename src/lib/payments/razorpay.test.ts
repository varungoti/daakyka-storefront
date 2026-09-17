import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay";
import { withEnv } from "../../../tests/helpers/env";

const TEST_KEY_SECRET = "test-razorpay-key-secret";
const TEST_WEBHOOK_SECRET = "test-razorpay-webhook-secret";

describe("isRazorpayConfigured", () => {
  it("is false when either key is missing", async () => {
    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, () => {
      assert.equal(isRazorpayConfigured(), false);
    });
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: undefined }, () => {
      assert.equal(isRazorpayConfigured(), false);
    });
  });

  it("is true when both keys are set", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "secret" }, () => {
      assert.equal(isRazorpayConfigured(), true);
    });
  });
});

describe("verifyPaymentSignature", () => {
  it("accepts a signature computed the way Razorpay Checkout.js does", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, () => {
      const orderId = "order_test123";
      const paymentId = "pay_test456";
      const validSignature = createHmac("sha256", TEST_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      assert.equal(verifyPaymentSignature(orderId, paymentId, validSignature), true);
    });
  });

  it("rejects a tampered signature", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, () => {
      const orderId = "order_test123";
      const paymentId = "pay_test456";
      const validSignature = createHmac("sha256", TEST_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
      const tampered = `${validSignature.slice(0, -1)}${validSignature.at(-1) === "0" ? "1" : "0"}`;

      assert.equal(verifyPaymentSignature(orderId, paymentId, tampered), false);
    });
  });

  it("rejects a signature computed for a different order/payment id", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, () => {
      const signatureForOther = createHmac("sha256", TEST_KEY_SECRET)
        .update("order_other|pay_other")
        .digest("hex");

      assert.equal(verifyPaymentSignature("order_test123", "pay_test456", signatureForOther), false);
    });
  });

  it("returns false when RAZORPAY_KEY_SECRET is unset", async () => {
    await withEnv({ RAZORPAY_KEY_SECRET: undefined }, () => {
      assert.equal(verifyPaymentSignature("order_1", "pay_1", "anything"), false);
    });
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a signature computed over the exact raw body", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, () => {
      const rawBody = JSON.stringify({ event: "payment.captured", payload: {} });
      const validSignature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");

      assert.equal(verifyWebhookSignature(rawBody, validSignature), true);
    });
  });

  it("rejects a tampered body against a signature computed for the original", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, () => {
      const rawBody = JSON.stringify({ event: "payment.captured", payload: {} });
      const validSignature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
      const tamperedBody = JSON.stringify({ event: "payment.captured", payload: { hacked: true } });

      assert.equal(verifyWebhookSignature(tamperedBody, validSignature), false);
    });
  });

  it("rejects a missing signature header", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, () => {
      assert.equal(verifyWebhookSignature("{}", null), false);
    });
  });

  it("returns false when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined }, () => {
      assert.equal(verifyWebhookSignature("{}", "somesignature"), false);
    });
  });
});
