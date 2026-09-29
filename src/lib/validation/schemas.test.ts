import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  announcementContentSchema,
  bulkOrderSchema,
  checkoutSchema,
  checkoutVerifySchema,
  customerAddressSchema,
  customerAddressUpdateSchema,
  customerForgotPasswordSchema,
  customerRegisterSchema,
  customerResetPasswordSchema,
  discountSchema,
  discountUpdateSchema,
  heroContentSchema,
  heroSlideSchema,
  heroSlidesContentSchema,
  homepageSectionSchemas,
  isHomepageSectionKey,
  loginSchema,
  newsletterSchema,
  notificationMarkReadSchema,
  offerSchema,
  offerUpdateSchema,
  segmentSchema,
  segmentUpdateSchema,
  seoPageRecordSchema,
  seoPageRecordUpdateSchema,
  templateSchema,
  templateUpdateSchema,
  testimonialSchema,
  testimonialUpdateSchema,
  trustStatsContentSchema,
  userInviteSchema,
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

  // F-071: marketingOptIn is separate, optional marketing consent — the
  // required consentGiven checkbox only ever means "contact me about this
  // enquiry" and must never be treated as opting the lead into campaigns.
  it("defaults marketingOptIn to false when the bulk order payload omits it", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.marketingOptIn, false);
    }
  });

  it("accepts an explicit marketingOptIn: true on the bulk order payload", () => {
    const result = bulkOrderSchema.safeParse({
      organization: "City Hospital",
      contactPerson: "Dr. Rao",
      email: "admin@hospital.com",
      phone: "9876543210",
      consentGiven: true,
      marketingOptIn: true,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.marketingOptIn, true);
    }
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

  // F-081: bcrypt truncates at 72 *bytes*. A password made of multi-byte
  // characters can exceed that well under 72 or even 200 characters, so
  // password-setting fields must check byte length, not just .max().
  it("accepts a 72-byte ASCII password (exactly at the bcrypt truncation point)", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "a".repeat(72),
      consentGiven: true,
    });
    assert.equal(result.success, true);
  });

  it("rejects a password over 72 bytes even when under the character max", () => {
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "a".repeat(73),
      consentGiven: true,
    });
    assert.equal(result.success, false);
  });

  it("rejects a multi-byte password that exceeds 72 bytes despite fewer than 72 characters", () => {
    // Each "😀" is 4 UTF-8 bytes; 20 of them is 80 bytes but only 20 chars
    // (well under the 8-char minimum concern and far under any char cap).
    const result = customerRegisterSchema.safeParse({
      name: "Priya Sharma",
      email: "priya@example.com",
      password: "\u{1F600}".repeat(20),
      consentGiven: true,
    });
    assert.equal(result.success, false);
  });

  it("still allows an existing account with a long password to log in (loginSchema is not byte-capped)", () => {
    // loginSchema checks a password against an existing hash rather than
    // setting one, so it must not reject an account whose password
    // predates the 72-byte cap.
    const result = loginSchema.safeParse({
      email: "varungoti@gmail.com",
      password: "a".repeat(150),
    });
    assert.equal(result.success, true);
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

  // Release-hardening Finding A: a customer address must pass the same
  // Indian phone/PIN-code rule as checkout, and normalised, so a bad
  // address can't be saved here and then reused at checkout.

  it("normalises a customer address's postal code and optional phone", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500 032",
      phone: "+91 98765 43210",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.postalCode, "500032");
      assert.equal(result.data.phone, "9876543210");
    }
  });

  it("accepts a customer address without a phone at all (optional)", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500032",
    });
    assert.equal(result.success, true);
  });

  it("rejects a customer address with the exact garbage postal code from the live audit", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "AB123",
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const flat = result.error.flatten();
      assert.ok(flat.fieldErrors.postalCode?.[0]);
    }
  });

  it("rejects a customer address with a malformed phone", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500032",
      phone: "12345",
    });
    assert.equal(result.success, false);
  });

  it("customerAddressUpdateSchema accepts a partial payload and still normalises a provided postal code", () => {
    const result = customerAddressUpdateSchema.safeParse({ postalCode: "110 001" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.postalCode, "110001");
    }
  });

  it("customerAddressUpdateSchema still rejects an invalid postal code", () => {
    assert.equal(customerAddressUpdateSchema.safeParse({ postalCode: "AB123" }).success, false);
  });

  // F-135: customerAddressUpdateSchema used to be customerAddressSchema
  // .partial(), which — because .partial() still applies each field's own
  // .default() — silently injected country: "IN" and isDefault: false into
  // every partial update, even when the caller only sent e.g. { label }.
  it("customerAddressUpdateSchema does not inject country/isDefault defaults for an omitted field", () => {
    const result = customerAddressUpdateSchema.safeParse({ label: "Office" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal("country" in result.data, false, "country must be left out, not defaulted to IN");
      assert.equal("isDefault" in result.data, false, "isDefault must be left out, not defaulted to false");
      assert.deepEqual(result.data, { label: "Office" });
    }
  });

  it("customerAddressUpdateSchema still accepts isDefault/country when the caller explicitly sends them", () => {
    const result = customerAddressUpdateSchema.safeParse({ isDefault: true, country: "IN" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.isDefault, true);
      assert.equal(result.data.country, "IN");
    }
  });

  // F-128: customerAddressSchema.country now matches shippingAddressSchema
  // — a saved address must also be India-only, since checkout's own
  // pincode/phone validation already assumes it is.
  it("rejects a customer address with a non-India country", () => {
    const result = customerAddressSchema.safeParse({
      line1: "221B Baker Street",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500032",
      country: "US",
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

  // F-128: a crafted checkout used to accept ANY 2-letter code (e.g. "US")
  // and still charge the domestic flat shipping rate — only the UI
  // hard-coded India. The store only ships within India today.
  it("rejects a shipping address with a valid-looking but non-India 2-letter country code", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      shippingAddress: { ...validCheckoutPayload.shippingAddress, country: "US" },
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.message.includes("India")));
    }
  });

  // Release-hardening Finding A: a live order was placed with phone
  // "12345" and pincode "AB123" — checkoutSchema now normalises legitimate
  // shapes to a canonical form and rejects everything else with a useful
  // message, at the field's own path.

  it("normalises common valid phone shapes to a bare 10-digit number", () => {
    for (const phone of ["9876543210", "+91 98765 43210", "098765 43210", "91-9876543210"]) {
      const result = checkoutSchema.safeParse({ ...validCheckoutPayload, phone });
      assert.equal(result.success, true, `expected "${phone}" to be accepted`);
      if (result.success) {
        assert.equal(result.data.phone, "9876543210", `expected "${phone}" to normalise to 9876543210`);
      }
    }
  });

  it("normalises a spaced pincode to 6 bare digits", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      shippingAddress: { ...validCheckoutPayload.shippingAddress, pincode: "500 032" },
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.shippingAddress.pincode, "500032");
    }
  });

  it("rejects the exact garbage phone/pincode from the live audit, with a useful message", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      phone: "12345",
      shippingAddress: { ...validCheckoutPayload.shippingAddress, pincode: "AB123" },
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const phoneIssue = result.error.issues.find((issue) => issue.path.join(".") === "phone");
      const pincodeIssue = result.error.issues.find(
        (issue) => issue.path.join(".") === "shippingAddress.pincode",
      );
      assert.ok(phoneIssue?.message.length, "expected a useful message for the invalid phone");
      assert.ok(pincodeIssue?.message.length, "expected a useful message for the invalid pincode");
    }
  });

  it("rejects a phone number starting with a non-mobile digit (e.g. a landline range)", () => {
    const result = checkoutSchema.safeParse({ ...validCheckoutPayload, phone: "1234567890" });
    assert.equal(result.success, false);
  });

  it("rejects a pincode starting with 0", () => {
    const result = checkoutSchema.safeParse({
      ...validCheckoutPayload,
      shippingAddress: { ...validCheckoutPayload.shippingAddress, pincode: "012345" },
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

// Admin CRUD completion (testimonials, segments, templates, offers, SEO
// records, notifications, users) — see tests/integration for the DB-backed
// round-trip tests; these cover just the zod validation boundary.

describe("testimonialSchema / testimonialUpdateSchema", () => {
  const valid = {
    quote: "Absolutely fantastic scrubs, would order again.",
    name: "Dr. Rao",
    title: "City Hospital",
    rating: 5,
    // A trusted host (see TRUSTED_IMAGE_HOSTS in image-hosts.ts) — an
    // arbitrary https URL like https://example.com/... is rejected, same
    // as it always would have been by next/image's remotePatterns.
    avatar: "https://images.pexels.com/photos/123/avatar.jpg",
    featured: false,
    active: true,
    sortOrder: 0,
  };

  it("accepts a valid testimonial", () => {
    assert.equal(testimonialSchema.safeParse(valid).success, true);
  });

  it("rejects a rating outside 1-5", () => {
    assert.equal(testimonialSchema.safeParse({ ...valid, rating: 6 }).success, false);
  });

  it("rejects a non-URL avatar", () => {
    assert.equal(testimonialSchema.safeParse({ ...valid, avatar: "not-a-url" }).success, false);
  });

  it("rejects an untrusted https host", () => {
    assert.equal(testimonialSchema.safeParse({ ...valid, avatar: "https://evil.example/x.jpg" }).success, false);
  });

  // F-211: the Media Library's own "copy URL" always returns a relative
  // `/cdn/<key>` path (see publicUrlForKey in src/lib/storage/r2.ts) —
  // this used to be rejected outright by a bare `z.string().url()`.
  it("accepts a relative Media Library /cdn/ path", () => {
    const result = testimonialSchema.safeParse({
      ...valid,
      avatar: "/cdn/media/testimonials/2026/09/abc123.webp",
    });
    assert.equal(result.success, true);
  });

  it("rejects a /cdn/ path attempting path traversal", () => {
    assert.equal(
      testimonialSchema.safeParse({ ...valid, avatar: "/cdn/../secrets.json" }).success,
      false,
    );
  });

  it("rejects a protocol-relative //host path masquerading as /cdn/", () => {
    assert.equal(
      testimonialSchema.safeParse({ ...valid, avatar: "//evil.example/cdn/x.jpg" }).success,
      false,
    );
  });

  // F-211: avatar is now optional — the owner can leave a testimonial
  // without a photo and the storefront falls back to initials, rather
  // than the field being a hard requirement to save at all.
  it("accepts an empty avatar (no photo)", () => {
    const result = testimonialSchema.safeParse({ ...valid, avatar: "" });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.avatar, "");
  });

  it("defaults avatar to an empty string when omitted", () => {
    const withoutAvatar: Record<string, unknown> = { ...valid };
    delete withoutAvatar.avatar;
    const result = testimonialSchema.safeParse(withoutAvatar);
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.avatar, "");
  });

  it("rejects a too-short quote", () => {
    assert.equal(testimonialSchema.safeParse({ ...valid, quote: "short" }).success, false);
  });

  it("testimonialUpdateSchema accepts a partial payload", () => {
    assert.equal(testimonialUpdateSchema.safeParse({ featured: true }).success, true);
  });

  it("testimonialUpdateSchema still rejects an invalid partial field", () => {
    assert.equal(testimonialUpdateSchema.safeParse({ rating: 10 }).success, false);
  });
});

describe("segmentSchema / segmentUpdateSchema", () => {
  const valid = { name: "Newsletter Subscribers", slug: "newsletter-subscribers", criteria: { source: "newsletter" } };

  it("accepts a valid segment", () => {
    assert.equal(segmentSchema.safeParse(valid).success, true);
  });

  it("rejects an uppercase slug", () => {
    assert.equal(segmentSchema.safeParse({ ...valid, slug: "Newsletter" }).success, false);
  });

  it("rejects a slug with spaces", () => {
    assert.equal(segmentSchema.safeParse({ ...valid, slug: "not a slug" }).success, false);
  });

  it("accepts criteria using the keys segment-resolver.ts actually reads", () => {
    const result = segmentSchema.safeParse({ ...valid, criteria: { pages: ["shop"], consent: true } });
    assert.equal(result.success, true);
  });

  // F-217: a key segment-resolver.ts doesn't recognize used to save fine
  // and just silently resolve to zero recipients — reject it up front
  // instead.
  it("rejects criteria with a key segment-resolver.ts doesn't recognize", () => {
    const result = segmentSchema.safeParse({ ...valid, criteria: { city: "Hyderabad" } });
    assert.equal(result.success, false);
  });

  it("rejects a non-array, non-string value for a known criteria key", () => {
    assert.equal(segmentSchema.safeParse({ ...valid, criteria: { consent: "yes" } }).success, false);
    assert.equal(segmentSchema.safeParse({ ...valid, criteria: { pages: "shop" } }).success, false);
  });

  it("segmentUpdateSchema accepts a partial payload", () => {
    assert.equal(segmentUpdateSchema.safeParse({ description: "Updated" }).success, true);
  });
});

describe("templateSchema / templateUpdateSchema", () => {
  const valid = { name: "Welcome Email", channel: "EMAIL" as const, body: "Hi {{first_name}}, welcome!" };

  it("accepts a valid template", () => {
    assert.equal(templateSchema.safeParse(valid).success, true);
  });

  it("rejects an invalid channel", () => {
    assert.equal(templateSchema.safeParse({ ...valid, channel: "SMS" }).success, false);
  });

  it("rejects a body that's too short", () => {
    assert.equal(templateSchema.safeParse({ ...valid, body: "hi" }).success, false);
  });

  it("templateUpdateSchema accepts a partial payload", () => {
    assert.equal(templateUpdateSchema.safeParse({ subject: "New subject" }).success, true);
  });
});

describe("offerSchema / offerUpdateSchema", () => {
  const valid = { name: "Free Shipping", type: "free_shipping", description: "Free shipping over ₹8,000." };

  it("accepts a valid offer without an explicit active flag (service layer defaults it)", () => {
    const result = offerSchema.safeParse(valid);
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.active, undefined);
  });

  it("rejects a missing description", () => {
    assert.equal(offerSchema.safeParse({ name: "X", type: "bundle" }).success, false);
  });

  it("accepts an arbitrary config object", () => {
    assert.equal(offerSchema.safeParse({ ...valid, config: { discount: "10%", minItems: 2 } }).success, true);
  });

  it("offerUpdateSchema accepts a partial payload", () => {
    assert.equal(offerUpdateSchema.safeParse({ active: false }).success, true);
  });
});

describe("seoPageRecordSchema / seoPageRecordUpdateSchema", () => {
  const valid = { path: "/shop", title: "Shop All Scrubs", metaDescription: "Browse premium medical scrubs." };

  it("accepts a valid record without an explicit status (service layer defaults it to ok)", () => {
    const result = seoPageRecordSchema.safeParse(valid);
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.status, undefined);
  });

  it("rejects a path that doesn't start with /", () => {
    assert.equal(seoPageRecordSchema.safeParse({ ...valid, path: "shop" }).success, false);
  });

  it("rejects an invalid status value", () => {
    assert.equal(seoPageRecordSchema.safeParse({ ...valid, status: "broken" }).success, false);
  });

  it("seoPageRecordUpdateSchema accepts a partial payload", () => {
    assert.equal(seoPageRecordUpdateSchema.safeParse({ title: "New Title" }).success, true);
  });
});

describe("notificationMarkReadSchema", () => {
  it("accepts { read: true }", () => {
    assert.equal(notificationMarkReadSchema.safeParse({ read: true }).success, true);
  });

  it("rejects a missing read field", () => {
    assert.equal(notificationMarkReadSchema.safeParse({}).success, false);
  });

  it("rejects a non-boolean read field", () => {
    assert.equal(notificationMarkReadSchema.safeParse({ read: "true" }).success, false);
  });
});

// Release-hardening F-5: admin homepage section content
// (PUT /api/admin/homepage/[key]) used to accept any JSON shape with zero
// validation — see src/app/api/admin/homepage/[key]/route.ts and
// tests/integration/homepage-cache.test.ts for the route-level auth-gate
// checks (the DB-backed round trip is already covered there).

describe("isHomepageSectionKey", () => {
  it("only the four known section keys map to a valid route param", () => {
    assert.equal(isHomepageSectionKey("hero"), true);
    assert.equal(isHomepageSectionKey("hero-slides"), true);
    assert.equal(isHomepageSectionKey("announcement"), true);
    assert.equal(isHomepageSectionKey("trust-stats"), true);
    assert.equal(isHomepageSectionKey("not-a-real-section"), false);
    assert.equal(isHomepageSectionKey(""), false);
  });
});

describe("heroContentSchema", () => {
  const valid = {
    eyebrow: "Welcome to DAAKYKA",
    headline: "Expertly Designed, Meticulously Crafted",
    subheadline: "Quality Uniforms & Linens for Pan India",
    description: "Hospital linens, medical scrubs, school uniforms, and corporate wear.",
    primaryCta: "Shop All Scrubs",
    secondaryCta: "Build Your Fit",
    rating: "",
    ratingLabel: "Hyderabad-Based · 9+ Years of Trusted Manufacturing",
  };

  it("accepts the real default hero content", () => {
    assert.equal(heroContentSchema.safeParse(valid).success, true);
  });

  it("accepts an empty `rating` (the documented no-star-row state)", () => {
    const result = heroContentSchema.safeParse({ ...valid, rating: "" });
    assert.equal(result.success, true);
  });

  it("rejects a missing required field with a useful message at its own path", () => {
    const withoutHeadline: Record<string, unknown> = { ...valid };
    delete withoutHeadline.headline;
    const result = heroContentSchema.safeParse(withoutHeadline);
    assert.equal(result.success, false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "headline");
      assert.ok(issue?.message.length, "expected a useful message for the missing headline");
    }
  });

  it("rejects an unrecognized key instead of silently storing it (.strict())", () => {
    const result = heroContentSchema.safeParse({ ...valid, notAField: "surprise" });
    assert.equal(result.success, false);
  });

  it("rejects the wrongly-shaped body from the live finding (an unrelated object) rather than corrupting the row", () => {
    const result = heroContentSchema.safeParse({ foo: "bar" });
    assert.equal(result.success, false);
  });

  it("rejects a non-string field (e.g. a number where a headline is expected)", () => {
    const result = heroContentSchema.safeParse({ ...valid, headline: 12345 });
    assert.equal(result.success, false);
  });
});

describe("announcementContentSchema", () => {
  it("accepts the real default announcement content", () => {
    const result = announcementContentSchema.safeParse({
      messages: ["Free Shipping on Orders Over ₹8,000", "30-Day Easy Returns", "Designed for Heroes"],
    });
    assert.equal(result.success, true);
  });

  it("accepts zero messages (announcement bar effectively disabled)", () => {
    assert.equal(announcementContentSchema.safeParse({ messages: [] }).success, true);
  });

  it("rejects a non-array messages field", () => {
    assert.equal(announcementContentSchema.safeParse({ messages: "not an array" }).success, false);
  });

  it("rejects an empty-string message", () => {
    assert.equal(announcementContentSchema.safeParse({ messages: [""] }).success, false);
  });

  it("rejects an unrecognized top-level key", () => {
    assert.equal(
      announcementContentSchema.safeParse({ messages: ["ok"], extra: true }).success,
      false,
    );
  });
});

describe("trustStatsContentSchema", () => {
  it("accepts the real default trust-stats content", () => {
    const result = trustStatsContentSchema.safeParse({
      stats: [
        { value: "9+", label: "Years Manufacturing" },
        { value: "Pan India", label: "Delivery & Fulfillment" },
        { value: "100%", label: "Secure Checkout" },
      ],
    });
    assert.equal(result.success, true);
  });

  it("rejects an empty stats array", () => {
    assert.equal(trustStatsContentSchema.safeParse({ stats: [] }).success, false);
  });

  it("rejects a stat missing its label", () => {
    assert.equal(trustStatsContentSchema.safeParse({ stats: [{ value: "9+" }] }).success, false);
  });

  it("rejects an unrecognized key on a nested stat entry (.strict() applies at every level)", () => {
    const result = trustStatsContentSchema.safeParse({
      stats: [{ value: "9+", label: "Years", icon: "star" }],
    });
    assert.equal(result.success, false);
  });
});

describe("heroSlideSchema / heroSlidesContentSchema", () => {
  const validSlide = {
    id: "hospital-scrubs",
    enabled: true,
    eyebrow: "For Hospitals",
    headline: "Scrubs, Gowns & Hospital Linens",
    subheadline: "Built for demanding healthcare environments",
    description: "Hygienic, durable scrubs, gowns, staff uniforms, and hospital linens.",
    primaryCta: { label: "Shop Hospital Range", href: "/for-hospitals" },
    secondaryCta: { label: "Request Bulk Quote", href: "/bulk-orders" },
    image: { assetId: "asset-1", url: "https://cdn.example.com/hero-1.webp", alt: "Hospital team in scrubs" },
    secondaryImage: null,
  };

  it("accepts a fully populated slide", () => {
    assert.equal(heroSlideSchema.safeParse(validSlide).success, true);
  });

  it("accepts a slide with both images null", () => {
    const result = heroSlideSchema.safeParse({ ...validSlide, image: null, secondaryImage: null });
    assert.equal(result.success, true);
  });

  it("accepts a relative /cdn/... image url (publicUrlForKey's own-proxy form, no R2_PUBLIC_BASE_URL configured)", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      image: { assetId: "asset-1", url: "/cdn/media/section/2026/09/de9a9319.webp", alt: "" },
    });
    assert.equal(result.success, true);
  });

  it("accepts a relative CTA href", () => {
    const result = heroSlideSchema.safeParse(validSlide);
    assert.equal(result.success, true);
  });

  it("accepts a full https CTA href", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      primaryCta: { label: "Learn more", href: "https://example.com/promo" },
    });
    assert.equal(result.success, true);
  });

  it("rejects a javascript: CTA href", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      primaryCta: { label: "Shop", href: "javascript:alert(1)" },
    });
    assert.equal(result.success, false);
  });

  it("rejects a data: CTA href", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      secondaryCta: { label: "Shop", href: "data:text/html,<script>alert(1)</script>" },
    });
    assert.equal(result.success, false);
  });

  it("rejects a protocol-relative (//) CTA href", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      primaryCta: { label: "Shop", href: "//evil.example.com" },
    });
    assert.equal(result.success, false);
  });

  it("rejects a scheme-less bare CTA href", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      primaryCta: { label: "Shop", href: "evil.example.com" },
    });
    assert.equal(result.success, false);
  });

  it("rejects an unrecognized key on a slide (.strict())", () => {
    const result = heroSlideSchema.safeParse({ ...validSlide, subtitle: "surprise" });
    assert.equal(result.success, false);
  });

  it("rejects an unrecognized key on a nested CTA (.strict() at every level)", () => {
    const result = heroSlideSchema.safeParse({
      ...validSlide,
      primaryCta: { label: "Shop", href: "/shop", icon: "arrow" },
    });
    assert.equal(result.success, false);
  });

  it("rejects a headline over the length bound", () => {
    const result = heroSlideSchema.safeParse({ ...validSlide, headline: "x".repeat(201) });
    assert.equal(result.success, false);
  });

  it("accepts zero slides (reverts the storefront to the legacy hero fallback)", () => {
    const result = heroSlidesContentSchema.safeParse({ slides: [], autoAdvanceMs: 6000 });
    assert.equal(result.success, true);
  });

  it("accepts up to 12 slides", () => {
    const slides = Array.from({ length: 12 }, (_, i) => ({ ...validSlide, id: `slide-${i}` }));
    const result = heroSlidesContentSchema.safeParse({ slides, autoAdvanceMs: 6000 });
    assert.equal(result.success, true);
  });

  it("rejects more than 12 slides", () => {
    const slides = Array.from({ length: 13 }, (_, i) => ({ ...validSlide, id: `slide-${i}` }));
    const result = heroSlidesContentSchema.safeParse({ slides, autoAdvanceMs: 6000 });
    assert.equal(result.success, false);
  });

  it("rejects an interval below 2 seconds", () => {
    const result = heroSlidesContentSchema.safeParse({ slides: [validSlide], autoAdvanceMs: 500 });
    assert.equal(result.success, false);
  });

  it("rejects an interval above 60 seconds", () => {
    const result = heroSlidesContentSchema.safeParse({ slides: [validSlide], autoAdvanceMs: 120_000 });
    assert.equal(result.success, false);
  });

  it("rejects a non-integer interval", () => {
    const result = heroSlidesContentSchema.safeParse({ slides: [validSlide], autoAdvanceMs: 3000.5 });
    assert.equal(result.success, false);
  });
});

describe("homepageSectionSchemas", () => {
  it("has exactly one schema per known section key", () => {
    assert.deepEqual(Object.keys(homepageSectionSchemas).sort(), [
      "announcement",
      "hero",
      "hero-slides",
      "trust-stats",
    ]);
  });
});

// F-038: percentages over 100%, an end date at or before the start date,
// and a date-only boundary that expired 5.5 hours too early (IST vs UTC
// midnight) all used to save without complaint.
describe("discountSchema (F-038)", () => {
  const valid = { code: "HERO10", type: "PERCENTAGE" as const, value: 10 };

  it("accepts a valid percentage code", () => {
    assert.equal(discountSchema.safeParse(valid).success, true);
  });

  it("rejects a PERCENTAGE value over 100", () => {
    const result = discountSchema.safeParse({ ...valid, value: 150 });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.path[0] === "value"));
    }
  });

  it("accepts a FIXED value over 100 (no percentage cap applies)", () => {
    const result = discountSchema.safeParse({ ...valid, type: "FIXED", value: 500 });
    assert.equal(result.success, true);
  });

  it("rejects an endsAt at or before startsAt", () => {
    const result = discountSchema.safeParse({
      ...valid,
      startsAt: "2026-12-31",
      endsAt: "2026-01-01",
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.path[0] === "endsAt"));
    }
  });

  it("rejects an endsAt exactly equal to startsAt", () => {
    const result = discountSchema.safeParse({
      ...valid,
      // Date-only bounds represent the whole IST calendar day; identical
      // dates are valid. Compare identical instants to exercise equality.
      startsAt: "2026-06-01T10:00:00.000Z",
      endsAt: "2026-06-01T10:00:00.000Z",
    });
    assert.equal(result.success, false);
  });

  // A date-only "YYYY-MM-DD" is what the admin's <input type="date"> sends.
  // z.coerce.date() alone parses that as UTC midnight (05:30 IST) — this
  // must instead run the whole IST calendar day: 00:00 IST through
  // 23:59:59.999 IST.
  it("parses a date-only startsAt as the start of that day in IST, not UTC", () => {
    const result = discountSchema.safeParse({ ...valid, startsAt: "2026-09-25" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.startsAt?.toISOString(), "2026-09-24T18:30:00.000Z");
    }
  });

  it("parses a date-only endsAt as the end of that day in IST, not UTC midnight", () => {
    const result = discountSchema.safeParse({ ...valid, endsAt: "2026-09-25" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.endsAt?.toISOString(), "2026-09-25T18:29:59.999Z");
    }
  });

  it("a date-only endsAt of today is still valid at 23:00 IST (17:30Z) and expired by the next UTC day", () => {
    const result = discountSchema.safeParse({ ...valid, endsAt: "2026-09-25" });
    assert.equal(result.success, true);
    if (result.success) {
      const endsAt = result.data.endsAt!;
      assert.ok(endsAt.getTime() > new Date("2026-09-25T17:30:00.000Z").getTime(), "expected 23:00 IST to be before endsAt");
      assert.ok(endsAt.getTime() < new Date("2026-09-26T00:00:00.000Z").getTime(), "expected endsAt to have passed by the next UTC day");
    }
  });

  it("leaves a full ISO timestamp untouched", () => {
    const result = discountSchema.safeParse({ ...valid, endsAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.endsAt?.toISOString(), "2026-09-25T12:00:00.000Z");
    }
  });

  it("rejects a code with spaces (e.g. a mis-pasted 'HERO 10')", () => {
    assert.equal(discountSchema.safeParse({ ...valid, code: "HERO 10" }).success, false);
  });
});

describe("discountUpdateSchema (F-038)", () => {
  // discountUpdateSchema deliberately has NO cross-field superRefine — Zod
  // 4 refuses .partial() on a refined object schema — so it can't catch a
  // >100% or endsAt<=startsAt that only becomes true once merged with the
  // existing row. That merged check lives in updateDiscount
  // (src/lib/discounts/index.ts) instead — see
  // tests/integration/discounts.test.ts for those cases.
  it("accepts a lone value over 100 in isolation (the cross-field check happens in updateDiscount)", () => {
    assert.equal(discountUpdateSchema.safeParse({ value: 500 }).success, true);
  });

  it("still normalizes a date-only endsAt to the end of the IST day", () => {
    const result = discountUpdateSchema.safeParse({ endsAt: "2026-09-25" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.endsAt?.toISOString(), "2026-09-25T18:29:59.999Z");
    }
  });

  it("accepts an empty partial payload", () => {
    assert.equal(discountUpdateSchema.safeParse({}).success, true);
  });
});

describe("userInviteSchema", () => {
  const valid = { name: "New Admin", email: "new-admin@example.com", role: "VIEWER" as const };

  it("accepts a valid invite payload", () => {
    assert.equal(userInviteSchema.safeParse(valid).success, true);
  });

  it("rejects an invalid email", () => {
    assert.equal(userInviteSchema.safeParse({ ...valid, email: "not-an-email" }).success, false);
  });

  it("rejects an unknown role", () => {
    assert.equal(userInviteSchema.safeParse({ ...valid, role: "GOD_MODE" }).success, false);
  });
});
