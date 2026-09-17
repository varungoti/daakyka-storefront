import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bulkOrderSchema,
  checkoutSchema,
  checkoutVerifySchema,
  customerAddressSchema,
  customerForgotPasswordSchema,
  customerRegisterSchema,
  customerResetPasswordSchema,
  loginSchema,
  newsletterSchema,
} from "@/lib/validation/schemas";

describe("validation schemas", () => {
  it("requires bulk order consent", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: false,
    });
    assert.equal(result.success, false);
  });

  it("accepts valid bulk order payload", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
    });
    assert.equal(result.success, true);
  });

  it("accepts a bulk order payload without organizationType/categoryInterest (backward compatible)", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.organizationType, undefined);
      assert.equal(result.data.categoryInterest, undefined);
    }
  });

  it("accepts a bulk order payload with organizationType and categoryInterest", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
      organizationType: "HOSPITAL",
      categoryInterest: ["Scrubs", "Hospital Linens"],
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data.categoryInterest, ["Scrubs", "Hospital Linens"]);
    }
  });

  it("rejects an unknown organizationType", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
      organizationType: "NOT_A_REAL_TYPE",
    });
    assert.equal(result.success, false);
  });

  it("rejects short admin passwords", () => {
    const result = loginSchema.safeParse({
      email: "varungoti@gmail.com",
      password: "short",
    });
    assert.equal(result.success, false);
  });

  it("requires newsletter consent", () => {
    const result = newsletterSchema.safeParse({
      email: "user@example.com",
      consentGiven: false,
    });
    assert.equal(result.success, false);
  });

  // Phase D1: customer accounts.

  it("accepts a valid customer registration payload", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "password123",
      consentGiven: true,
    });
    assert.equal(result.success, true);
  });

  it("rejects customer registration under 8 characters", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "short1",
      consentGiven: true,
    });
    assert.equal(result.success, false);
  });

  it("rejects customer registration without consent", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "password123",
      consentGiven: false,
    });
    assert.equal(result.success, false);
  });

  it("rejects customer registration with an overlong password (bcrypt truncation DoS guard)", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "a".repeat(201),
      consentGiven: true,
    });
    assert.equal(result.success, false);
  });

  it("accepts a bare email for forgot-password", () => {
    const result = customerForgotPasswordSchema.safeParse({ email: "priya@example.com" });
    assert.equal(result.success, true);
  });

  it("rejects reset-password with a short new password", () => {
    const result = customerResetPasswordSchema.safeParse({
      token: "a".repeat(32),
      newPassword: "short1",
    });
    assert.equal(result.success, false);
  });

  it("accepts a valid reset-password payload", () => {
    const result = customerResetPasswordSchema.safeParse({
      token: "a".repeat(32),
      newPassword: "newpassword123",
    });
    assert.equal(result.success, true);
  });

  it("requires the core fields on a customer address", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500032",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.country, "IN");
      assert.equal(result.data.isDefault, false);
    }
  });

  it("rejects a customer address missing a required field", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      postalCode: "500032",
    });
    assert.equal(result.success, false);
  });

  // Phase D3: checkout / Razorpay.

  const validCheckoutPayload = {
    items: [{ variantId: "var_1", quantity: 2 }],
    email: "shopper@example.com",
    phone: "9876543210",
    shippingAddress: {
      name: "Priya Sharma",
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500032",
    },
  };

  it("accepts a valid checkout payload and defaults country to IN", () => {
    const result = checkoutSchema.safeParse(validCheckoutPayload);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.shippingAddress.country, "IN");
    }
  });

  it("rejects checkout with an empty cart", () => {
    const result = checkoutSchema.safeParse({ ...validCheckoutPayload, items: [] });
    assert.equal(result.success, false);
  });

  it("rejects checkout with a missing shipping address field", () => {
    const addressWithoutCity: Record<string, unknown> = { ...validCheckoutPayload.shippingAddress };
    delete addressWithoutCity.city;
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      shippingAddress: addressWithoutCity,
    });
    assert.equal(result.success, false);
  });

  it("rejects checkout with an invalid email", () => {
    const result = checkoutSchema.safeParse({ ...validCheckoutPayload, email: "not-an-email" });
    assert.equal(result.success, false);
  });

  it("rejects checkout with a zero or negative quantity", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      items: [{ variantId: "var_1", quantity: 0 }],
    });
    assert.equal(result.success, false);
  });

  it("rejects a shipping address with a 3-letter country code", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      shippingAddress: { ...validCheckoutPayload.shippingAddress, country: "IND" },
    });
    assert.equal(result.success, false);
  });

  it("accepts a valid checkout-verify payload", () => {
    const result = checkoutVerifySchema.safeParse({
      orderNumber: "DK-2026-000123",
      razorpayPaymentId: "pay_test123",
      razorpayOrderId: "order_test123",
      razorpaySignature: "abc123",
    });
    assert.equal(result.success, true);
  });

  it("rejects a checkout-verify payload missing a field", () => {
    const result = checkoutVerifySchema.safeParse({
      orderNumber: "DK-2026-000123",
      razorpayPaymentId: "pay_test123",
      razorpayOrderId: "order_test123",
    });
    assert.equal(result.success, false);
  });
});
