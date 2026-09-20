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
    avatar: "https://example.com/avatar.jpg",
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

  it("accepts criteria as an arbitrary JSON object", () => {
    const result = segmentSchema.safeParse({ ...valid, criteria: { pages: ["shop"], consent: true } });
    assert.equal(result.success, true);
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
