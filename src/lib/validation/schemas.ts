import { z } from "zod";
import { INDIAN_PHONE_HINT, INDIAN_PINCODE_HINT, normalizeIndianPhone, normalizeIndianPincode } from "./india";

// Phase C7: kept as a plain string (not a Prisma enum) so the field stays
// additive/backward-compatible — older clients that omit it are unaffected.
export const bulkOrderOrganizationTypes = ["HOSPITAL", "SCHOOL", "CORPORATE", "OTHER"] as const;

/**
 * Release-hardening Finding A: a phone/PIN-code field that trims, then
 * normalises to the canonical Indian format via src/lib/validation/india.ts,
 * rejecting with a useful message (at this field's own path) when the
 * input can't be read as a valid one. Used by every phone/PIN field below
 * so checkout, saved addresses, and customer accounts all enforce and
 * normalise the same rule — server-side, which is the authoritative layer
 * since a client-side check (checkout-page-content.tsx, account-tabs.tsx)
 * can always be bypassed by calling the API directly. `.max()` bounds the
 * raw input before it ever reaches the regex.
 */
function indianPhoneField(message: string = INDIAN_PHONE_HINT) {
  return z
    .string()
    .trim()
    .max(40)
    .transform((value, ctx) => {
      const normalized = normalizeIndianPhone(value);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return normalized;
    });
}

function indianPincodeField(message: string = INDIAN_PINCODE_HINT) {
  return z
    .string()
    .trim()
    .max(20)
    .transform((value, ctx) => {
      const normalized = normalizeIndianPincode(value);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return normalized;
    });
}

// Phase D3: checkout / Razorpay.
export const shippingAddressSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  line1: z.string().trim().min(3, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "City is required").max(100),
  state: z.string().trim().min(2, "State is required").max(100),
  pincode: indianPincodeField(),
  country: z.string().trim().length(2, "Country must be a 2-letter code").default("IN"),
});

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

export const checkoutItemSchema = z.object({
  variantId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(50),
});

export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Your cart is empty").max(50),
  email: z.string().trim().email("Valid email is required").max(254),
  phone: indianPhoneField(),
  shippingAddress: shippingAddressSchema,
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const checkoutVerifySchema = z.object({
  orderNumber: z.string().trim().min(1).max(40),
  razorpayPaymentId: z.string().trim().min(1).max(100),
  razorpayOrderId: z.string().trim().min(1).max(100),
  razorpaySignature: z.string().trim().min(1).max(256),
  // Optional: the guest-access token the client already received from
  // POST /api/checkout (src/lib/orders/access-token.ts). Forwarded here
  // only so the "payment received" email can link straight back to the
  // same tokenised confirmation URL the browser is about to redirect to —
  // it is re-verified against the order's stored hash before use (see
  // /api/checkout/verify/route.ts) and never trusted as authorization for
  // this endpoint, which relies solely on the Razorpay signature. Missing
  // or wrong values just mean the email has no direct link, same as
  // before this field existed.
  orderToken: z.string().trim().min(1).max(200).optional(),
});

export type CheckoutVerifyInput = z.infer<typeof checkoutVerifySchema>;

export const bulkOrderSchema = z.object({
  organization: z.string().min(2, "Organization name is required").max(200),
  contactPerson: z.string().min(2, "Contact person is required").max(120),
  email: z.string().email("Valid email is required").max(254),
  phone: z.string().min(8, "Valid phone number is required").max(32),
  city: z.string().max(100).optional(),
  staffCount: z.coerce.number().int().positive().max(1_000_000).optional(),
  productsRequired: z.string().max(500).optional(),
  colorsRequired: z.string().max(500).optional(),
  sizesRequired: z.string().max(500).optional(),
  logoEmbroidery: z.boolean().default(false),
  deliveryTimeline: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  organizationType: z.enum(bulkOrderOrganizationTypes).optional(),
  categoryInterest: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "You must agree to be contacted" }),
});

export type BulkOrderInput = z.infer<typeof bulkOrderSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  // bcrypt silently truncates input past 72 bytes; capping well under
  // that (and under a reasonable password-manager-generated length)
  // also blocks a trivial large-payload DoS against the hashing step.
  password: z.string().min(8).max(200),
});

export const blogPostSchema = z.object({
  slug: z.string().min(2),
  title: z.string().min(4),
  excerpt: z.string().min(10),
  category: z.string().min(2),
  author: z.string().min(2),
  publishedAt: z.string(),
  readTime: z.string().min(2),
  image: z.string().url(),
  content: z.array(z.string().min(1)).min(1),
  status: z.enum(["DRAFT", "PUBLISHED"]),
});

export const newsletterSchema = z.object({
  email: z.string().email().max(254),
  source: z.string().max(100).optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "Consent is required" }),
});

export const segmentSchema = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().trim().max(2000).optional().nullable(),
  criteria: z.record(z.string(), z.unknown()).optional(),
});

export const segmentUpdateSchema = segmentSchema.partial();

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(150),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(300).optional().nullable(),
  body: z.string().trim().min(10).max(20_000),
  variables: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});

export const templateUpdateSchema = templateSchema.partial();

export const campaignSchema = z.object({
  name: z.string().min(2),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENT", "CANCELLED"]),
  segmentId: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  notes: z.string().optional(),
});

export const testimonialSchema = z.object({
  quote: z.string().trim().min(10).max(2000),
  name: z.string().trim().min(2).max(150),
  title: z.string().trim().min(2).max(150),
  rating: z.number().int().min(1).max(5),
  avatar: z.string().trim().url().max(500),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000_000),
});

export const testimonialUpdateSchema = testimonialSchema.partial();

// Phase — admin CRUD completion: offers, SEO overrides, notifications, users.

export const offerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  type: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(2000),
  // Deliberately `.optional()` without `.default()` (matching
  // src/lib/catalog/categories.ts's categoryInputSchema convention) so the
  // z.infer'd type keeps this field optional for callers — the service
  // layer (src/lib/offers/index.ts's createOffer) applies the `?? true`
  // fallback itself.
  active: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const offerUpdateSchema = offerSchema.partial();

export const seoPageRecordSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^\/[a-zA-Z0-9\-/_]*$/, "Path must start with / and use URL-safe characters"),
  title: z.string().trim().min(1).max(200),
  metaDescription: z.string().trim().min(1).max(320),
  h1: z.string().trim().max(200).optional().nullable(),
  // See offerSchema's `active` field above for why this is `.optional()`
  // without `.default()` — src/lib/seo/records.ts's createSeoRecord
  // applies the `?? "ok"` fallback itself.
  status: z.enum(["ok", "needs_meta", "missing_h1", "review"]).optional(),
  issues: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
});

export const seoPageRecordUpdateSchema = seoPageRecordSchema.partial();

export const notificationMarkReadSchema = z.object({
  read: z.boolean(),
});

export const userInviteSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  role: z.enum([
    "SUPER_ADMIN",
    "STORE_OWNER",
    "MARKETING_ADMIN",
    "CATALOG_MANAGER",
    "ORDER_MANAGER",
    "SEO_MANAGER",
    "CONTENT_EDITOR",
    "BULK_ORDER_MANAGER",
    "SUPPORT_AGENT",
    "VIEWER",
  ]),
});

// Phase D1: customer accounts. `loginSchema` above is reused as-is for
// POST /api/account/login (identical {email, password} shape and bounds).

const customerNameSchema = z.string().trim().min(2, "Name is required").max(120);
const customerPhoneSchema = indianPhoneField();

export const customerRegisterSchema = z.object({
  name: customerNameSchema,
  email: z.string().email().max(254),
  // Matches loginSchema's bounds: >=8 for a real password rule, <=200 to
  // stay well under bcrypt's 72-byte truncation point and block a
  // large-payload DoS against the hashing step.
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  phone: customerPhoneSchema.optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "You must agree to the terms" }),
});

export const customerForgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export const customerResetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const customerVerifyEmailSchema = z.object({
  token: z.string().min(16).max(512),
});

export const customerProfileUpdateSchema = z
  .object({
    name: customerNameSchema.optional(),
    phone: customerPhoneSchema.optional().nullable(),
    // Optional password-change sub-form on the Profile tab, reusing the
    // same bounds as customerResetPasswordSchema's newPassword. Changing
    // the password this way (while already logged in) requires the
    // current password rather than a reset token.
    currentPassword: z.string().min(1).max(200).optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
  })
  .refine((data) => !data.newPassword || !!data.currentPassword, {
    message: "Current password is required to set a new password",
    path: ["currentPassword"],
  });

export const customerAddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(2, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "City is required").max(100),
  state: z.string().trim().min(2, "State is required").max(100),
  postalCode: indianPincodeField(),
  country: z.string().trim().min(2).max(2).default("IN"),
  phone: customerPhoneSchema.optional(),
  isDefault: z.boolean().optional().default(false),
});

export const customerAddressUpdateSchema = customerAddressSchema.partial();

// Phase D2: reviews. Bounds mirror the length-bound style used above
// (customerNameSchema, shippingAddressSchema, etc) — title 4-120, body
// 10-2000, matching src/lib/reviews/create-review.ts's own constants
// (kept in sync manually; both are small enough that a shared constant
// would be more indirection than it saves).
export const reviewCreateSchema = z.object({
  productId: z.string().trim().min(1, "productId is required"),
  rating: z.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
  title: z.string().trim().min(4, "Title is too short").max(120, "Title is too long"),
  body: z.string().trim().min(10, "Review is too short").max(2000, "Review is too long"),
  photoAssetIds: z.array(z.string().trim().min(1)).max(3, "At most 3 photos are allowed").optional(),
});

export const adminReviewModerateSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

export const adminReviewBulkSchema = z.object({
  action: z.literal("approve"),
  ids: z.array(z.string().trim().min(1)).min(1, "At least one review id is required").max(100),
});

export const userUpdateSchema = z.object({
  name: z.string().min(2),
  role: z.enum([
    "SUPER_ADMIN",
    "STORE_OWNER",
    "MARKETING_ADMIN",
    "CATALOG_MANAGER",
    "ORDER_MANAGER",
    "SEO_MANAGER",
    "CONTENT_EDITOR",
    "BULK_ORDER_MANAGER",
    "SUPPORT_AGENT",
    "VIEWER",
  ]),
  active: z.boolean(),
});
