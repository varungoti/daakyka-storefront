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
