import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bulkOrderSchema, loginSchema, newsletterSchema } from "@/lib/validation/schemas";

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
});
