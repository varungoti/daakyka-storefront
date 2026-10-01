import { z } from "zod";
import { INDIAN_PHONE_HINT, INDIAN_PINCODE_HINT, normalizeIndianPhone, normalizeIndianPincode } from "./india";
import { isTrustedImageUrl } from "@/lib/security/image-hosts";

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

/**
 * F-081: bcrypt silently truncates its input at 72 *bytes*, not
 * characters — a password with multi-byte characters (emoji, most non-Latin
 * scripts) can hit that limit well under 72 characters, so a plain
 * `.max(72)` on the string's length isn't the right check. Used only on
 * fields that actually set/change a password (register, reset, profile
 * change); `loginSchema.password` deliberately keeps its wider max(200) so
 * an existing account whose password predates this cap can still log in —
 * bcrypt itself still only ever compares the first 72 bytes either way.
 */
function newPasswordField(message: string = "Password must be at least 8 characters") {
  return z
    .string()
    .min(8, message)
    .max(200)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "Password must be at most 72 bytes (bcrypt truncates beyond that)",
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
  // F-128: was `z.string().trim().length(2, ...)`, which accepted ANY
  // 2-letter code — the checkout UI hard-codes India, but a crafted
  // request could set e.g. "US" and still get charged the domestic flat
  // shipping rate. The store only ships within India today, so this is
  // the India-only checkout schema; loosen it if/when international
  // shipping is actually priced and supported.
  country: z.literal("IN", { message: "We currently ship within India only" }).default("IN"),
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
  // Release-hardening F7: optional coupon code typed at checkout. Only ever
  // a code string — never an amount — so the server (createOrderFromCart /
  // src/lib/discounts/index.ts) is the only place a discount is ever
  // computed; see that module's header comment.
  discountCode: z.string().trim().min(1).max(40).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Release-hardening F7: checkout-page "Apply" preview — re-prices the real
// cart server-side (same repriceLines() create-order.ts uses) rather than
// trusting a client-computed subtotal, so the previewed discount amount is
// never inflated by a stale/tampered cart total.
export const discountPreviewSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Your cart is empty").max(50),
  code: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(254).optional(),
});

export type DiscountPreviewInput = z.infer<typeof discountPreviewSchema>;

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
  // F-071: kept separate from — and never used as a substitute for —
  // consentGiven above, which only ever means "contact me about this
  // enquiry". This is real, optional marketing consent: left unticked by
  // default, it double-opt-ins the lead through the same
  // subscribeToNewsletter() flow as the footer newsletter form, so a lead
  // can only land in a marketing segment (segment-resolver.ts) after
  // confirming it from their inbox, same as anyone else.
  marketingOptIn: z.boolean().default(false),
});

export type BulkOrderInput = z.infer<typeof bulkOrderSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  // F-081: this checks a password against an *existing* hash, not sets
  // one, so it deliberately does NOT byte-cap at bcrypt's 72-byte
  // truncation point the way newPasswordField() does below — an account
  // whose password predates that cap (or has multi-byte characters
  // pushing it past 72 bytes at fewer than 72 characters) must still be
  // able to log in. bcrypt itself only ever compares the first 72 bytes
  // regardless of what's sent; max(200) here just blocks a large-payload
  // DoS against the hashing step.
  password: z.string().min(8).max(200),
});

// F-216/F-213: mirrors avatarImageSchema above — a same-origin root-relative
// path (a `/cdn/...` Media Library asset, or a static path like
// `/placeholder-scene.svg`, which is what Hermes-created drafts use as a
// stand-in image — see approval-executor.ts) or an https URL on an
// allowed host. `z.string().url()` used to reject every relative form
// outright, which is everything MediaLibraryBrowser (or the Hermes
// executor) actually returns here.
const blogImageSchema = z
  .string()
  .trim()
  .min(1, "Image is required")
  .max(2048)
  .refine(
    (value) => (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) || isTrustedImageUrl(value),
    "Use a Media Library image, a root-relative path, or an https image URL from an allowed host",
  );

export const blogPostSchema = z.object({
  // F-216: was `z.string().min(2)` — a slug with spaces/capitals (e.g.
  // "Audit Blog 123") saved and could even publish, but /blog/<that slug>
  // 404s (the public route matches on the exact, unencoded path segment),
  // so /blog linked to a page that didn't exist. Auto-lowercased and
  // hyphen-only, the same shape category/product slugs already enforce
  // (see segmentSchema's identical regex further down).
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Slug must be at least 2 characters")
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only"),
  title: z.string().trim().min(4).max(200),
  excerpt: z.string().trim().min(10).max(500),
  category: z.string().trim().min(2).max(80),
  author: z.string().trim().min(2).max(120),
  // F-216: was a bare `z.string()` — any text, including "25/09/2026" (what
  // an Indian admin types by habit), reached `new Date(...)` in the route
  // as an Invalid Date and crashed the write with an unhandled 500. Must
  // match the `<input type="date">` shape (see blog-post-editor.tsx) that
  // parseIstDateOnly (src/app/api/admin/blog/route.ts) expects.
  publishedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date (YYYY-MM-DD)")
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Invalid date" }),
  readTime: z.string().trim().min(2).max(40),
  image: blogImageSchema,
  content: z.array(z.string().trim().min(1).max(5000)).min(1).max(200),
  status: z.enum(["DRAFT", "PUBLISHED"]),
});

export const newsletterSchema = z.object({
  email: z.string().email().max(254),
  source: z.string().max(100).optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "Consent is required" }),
});

// F-217: src/lib/engagement/segment-resolver.ts only ever looks at these
// four keys (source, consent, leadType, pages) — everything else it falls
// through to `return []` for, silently matching nobody. `z.record` used to
// accept any JSON object here, so a typo'd or made-up key (e.g. {"city":
// "Hyderabad"}) saved without complaint and the segment just quietly
// resolved to zero recipients. `.strict()` rejects any key outside this
// set at save time instead, so that mistake is caught on the spot rather
// than discovered after the campaign "sends" to nobody.
const segmentCriteriaSchema = z
  .object({
    source: z.string().trim().min(1).max(100).optional(),
    consent: z.boolean().optional(),
    leadType: z.string().trim().min(1).max(100).optional(),
    pages: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  })
  .strict();

// F-219: the admin forms show these messages next to the field that failed,
// so the bounds below carry readable copy instead of zod's defaults
// ("Too small: expected string to have >=2 characters").
export const segmentSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150, "Name must be at most 150 characters"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(160, "Slug must be at most 160 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
  description: z.string().trim().max(2000).optional().nullable(),
  criteria: segmentCriteriaSchema.optional(),
});

export const segmentUpdateSchema = segmentSchema.partial();

export const templateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150, "Name must be at most 150 characters"),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(300, "Subject must be at most 300 characters").optional().nullable(),
  body: z.string().trim().min(10, "Body must be at least 10 characters").max(20_000, "Body must be at most 20,000 characters"),
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

// F-217: the campaign editor (src/components/admin/campaign-form.tsx) edits
// a campaign's content — name/channel/segment/template/notes/send time —
// separately from the SENT/SCHEDULED/etc. status transitions
// campaign-status-select.tsx drives; every field here is optional so
// PATCH /api/admin/campaigns/[id] can tell "just changing status" (only
// `status`/`sendNow` sent) apart from "editing details" (everything else)
// without needing two separate schemas or endpoints. `scheduledAt` uses
// `.datetime()` (an ISO string with an offset), matching the existing
// status-update path in that same route.
export const campaignUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
  segmentId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENT", "CANCELLED"]).optional(),
  sendNow: z.boolean().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

// F-211: Media Library assets are served from this app's own relative
// `/cdn/<key>` route (see publicUrlForKey in src/lib/storage/r2.ts)
// whenever no public R2 base URL is configured — true for every asset in
// this environment — so a plain `.url()` check rejects every real asset
// the Media Library picker can actually return, the same trap
// heroSlideImageSchema's doc comment further down documents (and
// sidesteps by skipping URL validation entirely; this one instead
// validates the *shape* of what it accepts, since `avatar` is a bare
// string with no separate `assetId` field to lean on). Accepts: empty
// (no photo — testimonials-section.tsx falls back to initials), a
// same-origin `/cdn/...` media path, or an https URL on an allowed host
// (isTrustedImageUrl — covers the seeded Pexels/Unsplash testimonials and
// an R2 public base URL when one is configured).
const avatarImageSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/cdn/") && !value.startsWith("//") && !value.includes("..")) ||
      isTrustedImageUrl(value),
    "Pick an image from the Media Library, or use an https image URL from an allowed host",
  );

export const testimonialSchema = z.object({
  quote: z.string().trim().min(10).max(2000),
  name: z.string().trim().min(2).max(150),
  title: z.string().trim().min(2).max(150),
  rating: z.number().int().min(1).max(5),
  avatar: avatarImageSchema.default(""),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000_000),
});

export const testimonialUpdateSchema = testimonialSchema.partial();

// Phase — admin CRUD completion: offers, SEO overrides, notifications, users.

export const offerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150, "Name must be at most 150 characters"),
  type: z.string().trim().min(2, "Type must be at least 2 characters").max(60, "Type must be at most 60 characters"),
  description: z
    .string()
    .trim()
    .min(5, "Description must be at least 5 characters")
    .max(2000, "Description must be at most 2,000 characters"),
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
    .min(1, "Path is required")
    .max(300, "Path must be at most 300 characters")
    .regex(/^\/[a-zA-Z0-9\-/_]*$/, "Path must start with / and use URL-safe characters"),
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be at most 200 characters"),
  metaDescription: z
    .string()
    .trim()
    .min(1, "Meta description is required")
    .max(320, "Meta description must be at most 320 characters"),
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

/**
 * F-057: POST /api/admin/account/password (self-service admin password
 * change). Deliberately its own schema rather than reusing
 * newPasswordField() — that helper's min(8) matches the customer-facing
 * bounds; an admin account can see every order and customer's PII, so
 * this uses the same 12-character floor prisma/seed.ts's
 * isInsecureSeedPassword() already enforces for a Vercel deploy's seed
 * password (src/lib/auth/seed-defaults.ts's MIN_SEED_PASSWORD_LENGTH).
 */
export const adminChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "Password must be at most 72 bytes (bcrypt truncates beyond that)",
    }),
});

export const userInviteSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150, "Name must be at most 150 characters"),
  email: z.string().trim().email("Enter a valid email address").max(254, "Email must be at most 254 characters"),
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
  // See newPasswordField's doc comment: this actually sets the account's
  // password, so it's byte-capped at bcrypt's 72-byte truncation point
  // (loginSchema.password is not, so existing accounts can still log in).
  password: newPasswordField(),
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
  newPassword: newPasswordField(),
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
    // current password rather than a reset token. currentPassword is
    // checked against the existing hash, not set as a new one, so it
    // keeps the wider max(200) rather than the 72-byte cap.
    currentPassword: z.string().min(1).max(200).optional(),
    newPassword: newPasswordField().optional(),
  })
  .refine((data) => !data.newPassword || !!data.currentPassword, {
    message: "Current password is required to set a new password",
    path: ["currentPassword"],
  });

// F-135: kept WITHOUT any `.default()` — see customerAddressUpdateSchema's
// doc comment below for why. customerAddressSchema (the create schema)
// re-adds the defaults on top of this same shape.
const customerAddressBaseSchema = z.object({
  label: z.string().trim().max(60).optional(),
  // F-134: who the shipment is addressed to — nullable/optional so
  // existing rows (and any write path that doesn't send it) are
  // unaffected; see the matching CustomerAddress.recipientName column.
  recipientName: customerNameSchema.optional(),
  line1: z.string().trim().min(2, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2, "City is required").max(100),
  state: z.string().trim().min(2, "State is required").max(100),
  postalCode: indianPincodeField(),
  // F-128: was `z.string().trim().min(2).max(2)`, which accepted any
  // 2-letter code even though postalCode/phone above are already
  // India-only validated. Matches shippingAddressSchema's identical
  // restriction.
  country: z.literal("IN", { message: "We currently ship within India only" }),
  phone: customerPhoneSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const customerAddressSchema = customerAddressBaseSchema.extend({
  country: customerAddressBaseSchema.shape.country.default("IN"),
  isDefault: z.boolean().optional().default(false),
});

// F-135 fix: this used to be `customerAddressSchema.partial()`. In Zod
// 4.4.3, `.partial()` still applies each field's own `.default()` even
// when the caller's input omits that key entirely — confirmed directly:
// `z.object({ country: z.string().default("IN") }).partial().parse({})`
// returns `{ country: "IN" }`, not `{}`. So a PATCH sending only
// `{ label: "x" }` parsed to `{ label: "x", country: "IN", isDefault:
// false }`, and the route (addresses/[id]/route.ts) spread that straight
// into `db.customerAddress.update({ data: parsed.data })` — silently
// clearing `isDefault` and resetting `country` on every partial update.
// Building the update schema from customerAddressBaseSchema (no
// `.default()` anywhere in it) instead means an omitted field parses to
// `undefined` and is left off the update entirely, so only the fields the
// caller actually sent are touched.
export const customerAddressUpdateSchema = customerAddressBaseSchema.partial();

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
  // F-343: the status this admin last saw the review in, so the write can
  // be conditioned on nobody else having moderated it in the meantime (see
  // ReviewConcurrentModificationError in lib/reviews/moderate-review.ts).
  // Optional so an older cached client bundle mid-deploy still gets a
  // (best-effort, unconditional) write instead of a hard validation error.
  fromStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export const adminReviewBulkSchema = z.object({
  // F-203: "reject" added alongside "approve" for the bulk moderation
  // queue's "Reject N selected" action.
  action: z.enum(["approve", "reject"]),
  ids: z.array(z.string().trim().min(1)).min(1, "At least one review id is required").max(100),
});

// Release-hardening F-5: admin homepage section content
// (PUT /api/admin/homepage/[key]) previously passed the raw request body
// straight into updateHomepageSection() with zero validation — a
// wrongly-shaped body could corrupt the live hero/announcement/trust-stats
// content (confirmed live; see the finding write-up). One schema per
// section key, matching the corresponding interface in
// src/lib/homepage/index.ts field-for-field. `.strict()` on every object
// level so an unknown key is rejected rather than silently stored.

export const heroContentSchema = z
  .object({
    eyebrow: z.string().trim().min(1, "Eyebrow is required").max(120),
    headline: z.string().trim().min(1, "Headline is required").max(200),
    subheadline: z.string().trim().min(1, "Subheadline is required").max(200),
    description: z.string().trim().min(1, "Description is required").max(1000),
    primaryCta: z.string().trim().min(1, "Primary CTA is required").max(60),
    secondaryCta: z.string().trim().min(1, "Secondary CTA is required").max(60),
    // Deliberately allowed empty: src/lib/homepage/index.ts only renders
    // the star row when `rating` is non-empty — that's a legitimate,
    // intentional state (see defaultHero's own comment there), not a
    // validation failure.
    rating: z.string().trim().max(20),
    ratingLabel: z.string().trim().min(1, "Rating label is required").max(200),
  })
  .strict();

export const announcementContentSchema = z
  .object({
    messages: z.array(z.string().trim().min(1, "A message can't be empty").max(200)).max(10),
  })
  .strict();

export const trustStatsContentSchema = z
  .object({
    stats: z
      .array(
        z
          .object({
            value: z.string().trim().min(1, "Value is required").max(20),
            label: z.string().trim().min(1, "Label is required").max(60),
          })
          .strict(),
      )
      .min(1, "At least one stat is required")
      .max(12),
  })
  .strict();

// Animated hero carousel (release-hardening — configurable hero carousel):
// PUT /api/admin/homepage/hero-slides, validated the same way and for the
// same reason as heroContentSchema above (F-5). A slide's `id` is a
// stable client-generated identifier (not a DB row id — slides live
// inside this section's single JSON `content` blob, exactly like
// heroContentSchema's fields do for the legacy single hero), used for
// React keys and reorder identity in the admin editor
// (src/components/admin/hero-slides-editor.tsx).
//
// `href` on a CTA accepts a same-origin relative path ("/shop") or a full
// http(s) URL only — never `javascript:`, `data:`, or any other
// non-navigational scheme. `new URL(value).protocol` rejects those
// outright (and a scheme-less bare string like "example.com" fails to
// parse at all, forcing an explicit "/" or "https://"); a leading "//" or
// "/\\" is rejected too since browsers can treat either as
// protocol-relative, which would silently leave the site.
const ctaHrefSchema = z
  .string()
  .trim()
  .min(1, "Link is required")
  .max(300, "Link is too long")
  .refine((value) => {
    if (value.startsWith("/")) {
      return !value.startsWith("//") && !value.startsWith("/\\");
    }
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Link must be a relative path starting with / or a full http(s) URL");

const heroSlideCtaSchema = z
  .object({
    label: z.string().trim().min(1, "CTA label is required").max(60, "CTA label is too long"),
    href: ctaHrefSchema,
  })
  .strict();

// Snapshots the picked MediaLibraryBrowser asset's id/url/alt at save time
// (mirrors testimonialSchema's `avatar` — a plain URL string, not a live
// FK join) rather than re-resolving a MediaAsset relation on every
// homepage read. `assetId` is kept alongside the resolved url/alt purely
// so the admin editor can show "currently selected" state and so
// deleteUnattachedMediaAsset (src/lib/media/store.ts) can refuse to
// delete an asset a live slide still references.
//
// `url` is deliberately NOT `.url()`-validated: publicUrlForKey
// (src/lib/storage/r2.ts) returns a *relative* `/cdn/<key>` path whenever
// R2_PUBLIC_BASE_URL isn't configured (this app's own proxy route, since
// the bucket has no public-read access) — confirmed against real seeded
// MediaAsset rows in this environment — and only an absolute URL once
// that env var is set. `z.string().url()` rejects the relative form
// outright, which would reject every real asset MediaLibraryBrowser can
// actually return here.
const heroSlideImageSchema = z
  .object({
    assetId: z.string().trim().min(1).max(200),
    url: z.string().trim().min(1, "Image URL is required").max(1000),
    alt: z.string().trim().max(300),
  })
  .strict();

export const heroSlideSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    eyebrow: z.string().trim().min(1, "Eyebrow is required").max(120),
    headline: z.string().trim().min(1, "Headline is required").max(200),
    subheadline: z.string().trim().min(1, "Subheadline is required").max(200),
    description: z.string().trim().min(1, "Description is required").max(1000),
    primaryCta: heroSlideCtaSchema,
    secondaryCta: heroSlideCtaSchema,
    image: heroSlideImageSchema.nullable(),
    secondaryImage: heroSlideImageSchema.nullable(),
  })
  .strict();

// No `.min(1)` on `slides` — saving an empty array is a legitimate,
// intentional admin action ("remove every slide") that reverts the
// storefront to the legacy single-hero fallback (see
// getHeroSlidesContent() in src/lib/homepage/index.ts), not a validation
// failure.
export const heroSlidesContentSchema = z
  .object({
    slides: z.array(heroSlideSchema).max(12, "At most 12 slides are allowed"),
    autoAdvanceMs: z
      .number()
      .int()
      .min(2000, "Interval must be at least 2 seconds")
      .max(60_000, "Interval must be at most 60 seconds"),
  })
  .strict();

export const homepageSectionKeys = ["hero", "hero-slides", "announcement", "trust-stats"] as const;
export type HomepageSectionKey = (typeof homepageSectionKeys)[number];

export function isHomepageSectionKey(key: string): key is HomepageSectionKey {
  return (homepageSectionKeys as readonly string[]).includes(key);
}

export const homepageSectionSchemas = {
  hero: heroContentSchema,
  "hero-slides": heroSlidesContentSchema,
  announcement: announcementContentSchema,
  "trust-stats": trustStatsContentSchema,
} satisfies Record<HomepageSectionKey, z.ZodTypeAny>;

// F-038: a bare "YYYY-MM-DD" (what the admin date-picker inputs send)
// parsed by z.coerce.date() lands at UTC midnight, i.e. 05:30 IST — so a
// code advertised "valid until 25 Sep" actually expired at 05:30 IST that
// SAME morning (assertDiscountUsable treats endsAt <= now as expired), and
// "valid from" likewise started 5.5 hours late. Store owners and shoppers
// are IST; a date-only boundary should mean the whole IST calendar day.
// Preprocessing here means every caller (admin UI, any future API client)
// gets this, not just one form. A full ISO timestamp (already carrying its
// own offset) passes through unchanged.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const istStartOfDay = z.preprocess(
  (value) => (typeof value === "string" && DATE_ONLY_PATTERN.test(value) ? new Date(`${value}T00:00:00+05:30`) : value),
  z.coerce.date(),
);
const istEndOfDay = z.preprocess(
  (value) => (typeof value === "string" && DATE_ONLY_PATTERN.test(value) ? new Date(`${value}T23:59:59.999+05:30`) : value),
  z.coerce.date(),
);

// F-038: shared by discountSchema's superRefine below AND updateDiscount
// (src/lib/discounts/index.ts), which runs it again against the record
// MERGED with the existing row — a PATCH sending only `{ value: 500 }` on
// an existing PERCENTAGE code, or only `{ endsAt }` on a code whose
// startsAt is already in the future, must be caught too, not just a
// create that sends every field at once.
export function validateDiscountRules(
  discount: { type?: "PERCENTAGE" | "FIXED"; value?: number; startsAt?: Date | null; endsAt?: Date | null },
  addIssue: (issue: { path: (string | number)[]; message: string }) => void,
): void {
  if (discount.type === "PERCENTAGE" && discount.value !== undefined && discount.value > 100) {
    addIssue({ path: ["value"], message: "Percentage can't exceed 100" });
  }
  if (discount.startsAt && discount.endsAt && discount.endsAt.getTime() <= discount.startsAt.getTime()) {
    addIssue({ path: ["endsAt"], message: "End date must be after the start date" });
  }
}

// Release-hardening F7: admin discount-code CRUD
// (POST/PATCH /api/admin/discounts). `minSubtotal`/`maxRedemptions`/
// `maxRedemptionsPerCustomer`/`startsAt`/`endsAt` are all `.nullable()` (as
// well as `.optional()` on the update variant) so an admin can explicitly
// clear a previously-set cap/window, matching the distinction
// src/lib/discounts/index.ts's updateDiscount draws between "omitted, leave
// alone" (undefined) and "explicitly cleared" (null).
//
// F-038: kept WITHOUT the cross-field superRefine below — Zod 4 refuses
// `.partial()` on an object schema that already carries a refinement
// ("`.partial()` cannot be used on object schemas containing
// refinements"). discountUpdateSchema is built from this unrefined base;
// discountSchema (the create schema) adds the refinement on top.
const discountBaseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Code must be at least 3 characters")
    .max(40, "Code must be at most 40 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphens, and underscores only"),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.number().positive("Value must be greater than 0").max(10_000_000),
  minSubtotal: z.number().min(0).max(10_000_000).nullable().optional(),
  maxRedemptions: z.number().int().positive("Must be at least 1").max(1_000_000).nullable().optional(),
  maxRedemptionsPerCustomer: z.number().int().positive("Must be at least 1").max(1_000).nullable().optional(),
  startsAt: istStartOfDay.nullable().optional(),
  endsAt: istEndOfDay.nullable().optional(),
  active: z.boolean().optional(),
});

// F-038: percentages over 100% (free merchandise on a typo) and an end
// date at or before the start date (a code that can never be redeemed)
// used to save without complaint.
export const discountSchema = discountBaseSchema.superRefine((discount, ctx) => {
  validateDiscountRules(discount, (issue) => ctx.addIssue({ code: z.ZodIssueCode.custom, ...issue }));
});

export const discountUpdateSchema = discountBaseSchema.partial();

export type DiscountInput = z.infer<typeof discountSchema>;
export type DiscountUpdateInput = z.infer<typeof discountUpdateSchema>;

// Shopify-parity gap (storefront-ux.md): back-in-stock "Notify me" capture
// (POST /api/back-in-stock).
export const backInStockSubscribeSchema = z.object({
  variantId: z.string().trim().min(1, "variantId is required"),
  email: z.string().trim().email("Valid email is required").max(254),
});

export type BackInStockSubscribeInput = z.infer<typeof backInStockSubscribeSchema>;

export const userUpdateSchema = z.object({
  // F-172: was a bare `z.string().min(2)` — no trim and no upper bound, so a
  // 5,000-character (or all-whitespace) name saved. Matches userInviteSchema.
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150, "Name must be at most 150 characters"),
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
