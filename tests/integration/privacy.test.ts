import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { db } from "@/lib/db";
import { POST as cronRetention } from "@/app/api/cron/retention/route";
import { GET as adminCustomerExport } from "@/app/api/admin/customers/[id]/export/route";
import { POST as adminCustomerErase } from "@/app/api/admin/customers/[id]/erase/route";
import { POST as adminPrivacyExport } from "@/app/api/admin/privacy/export/route";
import { POST as adminPrivacyErase } from "@/app/api/admin/privacy/erase/route";
import { GET as accountExport } from "@/app/api/account/export/route";
import { POST as accountDelete } from "@/app/api/account/delete/route";
import { POST as accountEmail } from "@/app/api/account/email/route";
import { GET as accountMarketingGet, PUT as accountMarketingPut } from "@/app/api/account/marketing/route";
import { GET as accountEmailConfirm } from "@/app/api/account/email/confirm/route";
import { hashPassword } from "@/lib/customer-auth/password";
import {
  confirmEmailChange,
  readEmailChangeToken,
  requestEmailChange,
  signEmailChangeToken,
} from "@/lib/customer-auth/email-change";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { confirmNewsletterSubscriber } from "@/lib/engagement/newsletter";
import { openOutboxBody } from "@/lib/engagement/outbox-seal";
import { ERASED_EMAIL } from "@/lib/privacy/anonymise-orders";
import { ErasureBlockedError, erasePersonalData } from "@/lib/privacy/erase";
import { exportPersonalData } from "@/lib/privacy/export";
import { getMarketingStatus, setMarketingPreference } from "@/lib/privacy/preferences";
import { RETENTION_RULES, formatRetentionPeriod, runRetention } from "@/lib/privacy/retention";
import { findAnyAdminId } from "../helpers/admin-user";
import { withEnv } from "../helpers/env";

/**
 * F-315 (data-principal rights) and F-316 (retention). Everything is seeded
 * with unique emails, and every "bystander" row proves an erasure or purge
 * touches only what it should.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const uid = () => randomUUID().replace(/-/g, "").slice(0, 10);

function address(name = "Priya Sharma") {
  return { name, line1: "12 Test Street", line2: "Flat 4", city: "Hyderabad", state: "Telangana", pincode: "500032", country: "IN" };
}

async function createOrder(input: {
  email: string;
  status?: "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  customerId?: string | null;
  createdAt?: Date;
  phone?: string | null;
  total?: number;
}) {
  const unique = uid();
  return db.order.create({
    data: {
      number: `DK-TEST-${unique}`,
      email: input.email,
      phone: input.phone ?? "9876543210",
      customerId: input.customerId ?? null,
      shippingAddress: address(),
      subtotal: input.total ?? 1000,
      shipping: 0,
      total: input.total ?? 1000,
      status: input.status ?? "DELIVERED",
      accessTokenHash: `hash-${unique}`,
      invoiceNumber: `INV-TEST-${unique}`,
      notes: "Leave at the gate",
      adminNotes: "Called the customer",
      createdAt: input.createdAt ?? new Date(),
      items: { create: [{ productName: "Scrub Top", variantLabel: "M / Navy", sku: `SKU-${unique}`, unitPrice: input.total ?? 1000, quantity: 1 }] },
    },
    include: { items: true },
  });
}

/** Everything one person owns, spread across the tables the audit listed. */
async function seedPerson(label: string) {
  const unique = uid();
  const email = `privacy-${label}-${unique}@example.com`;
  const phone = `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  const customer = await db.customer.create({
    data: { email, name: "Priya Sharma", phone, passwordHash: await hashPassword("password123"), emailVerifiedAt: new Date() },
  });
  await db.customerAddress.create({
    data: { customerId: customer.id, line1: "12 Test Street", city: "Hyderabad", state: "Telangana", postalCode: "500032", phone },
  });
  await issueCustomerToken(customer.id, "RESET");

  const category = await db.category.create({ data: { name: `Privacy Cat ${unique}`, slug: `privacy-cat-${unique}`, section: "GENERAL" } });
  const product = await db.product.create({
    data: { name: `Privacy Product ${unique}`, slug: `privacy-product-${unique}`, categoryId: category.id, status: "ACTIVE", price: 500 },
  });
  const variant = await db.productVariant.create({
    data: { productId: product.id, sku: `DK-PRIV-${unique}`, size: "M", color: "Navy", stock: 0, active: true },
  });
  await db.wishlistItem.create({ data: { customerId: customer.id, productId: product.id } });
  await db.review.create({ data: { productId: product.id, customerId: customer.id, rating: 5, body: "Great scrubs, very comfortable." } });

  const deliveredOrder = await createOrder({ email, customerId: customer.id, phone });
  // A guest order placed with the same address in different letter case.
  const guestOrder = await createOrder({ email: email.toUpperCase(), status: "CANCELLED", phone: null });

  const discount = await db.discount.create({ data: { code: `PRIV${unique.toUpperCase()}`, type: "PERCENTAGE", value: 10, redeemedCount: 1 } });
  await db.discountRedemption.create({ data: { discountId: discount.id, orderId: deliveredOrder.id, email, customerId: customer.id } });

  await db.contactEnquiry.create({ data: { name: "Priya Sharma", email, phone, message: "Do you stitch to order?" } });
  await db.bulkOrderLead.create({
    data: { organization: "Care Hospital", contactPerson: "Priya Sharma", email, phone, notes: "Need 200 scrubs" },
  });
  await db.newsletterSubscriber.create({ data: { email, consentGiven: true, confirmedAt: new Date() } });
  await db.whatsAppOptIn.create({ data: { phone } });
  await db.backInStockSubscription.create({ data: { productId: product.id, variantId: variant.id, email } });

  const journey = await db.customerJourney.create({ data: { name: `Privacy journey ${unique}`, slug: `privacy-journey-${unique}`, trigger: "order_created" } });
  await db.journeyEnrollment.create({ data: { journeyId: journey.id, email, phone, trigger: "order_created", context: JSON.stringify({ firstName: "Priya" }) } });
  await db.journeyEvent.create({ data: { journeyId: journey.id, trigger: "order_created", channel: "EMAIL", recipient: email } });

  const campaign = await db.campaign.create({ data: { name: `Privacy campaign ${unique}`, channel: "EMAIL" } });
  await db.campaignDelivery.create({ data: { campaignId: campaign.id, recipient: email, channel: "EMAIL", status: "sent" } });

  await db.emailOutbox.create({ data: { to: email, subject: "Order confirmed", html: "<p>x</p>", kind: "order_confirmation_admin", status: "SENT" } });
  await db.adminNotification.create({
    data: { title: "New order", body: `${email} — ₹1,000 (paid)`, type: "order_paid", metadata: JSON.stringify({ email, total: 1000 }) },
  });
  await db.cartAbandonmentEvent.create({ data: { email, itemCount: 2, subtotal: 1500 } });
  await db.orderEvent.create({ data: { email, phone, total: 999, source: "shopify" } });

  return { email, phone, customer, product, variant, deliveredOrder, guestOrder, discount, journey, campaign, category };
}

type Person = Awaited<ReturnType<typeof seedPerson>>;

/** How many rows in each table still match this person (0 everywhere after an erasure). */
async function remainingRows(person: { email: string; phone: string; customerId?: string }) {
  const email = { equals: person.email, mode: "insensitive" as const };
  const customerId = person.customerId ?? "none";
  return {
    customer: await db.customer.count({ where: { OR: [{ id: customerId }, { email }] } }),
    addresses: await db.customerAddress.count({ where: { customerId } }),
    tokens: await db.customerToken.count({ where: { customerId } }),
    wishlist: await db.wishlistItem.count({ where: { customerId } }),
    reviews: await db.review.count({ where: { customerId } }),
    ordersWithEmail: await db.order.count({ where: { email } }),
    contactEnquiries: await db.contactEnquiry.count({ where: { OR: [{ email }, { phone: person.phone }] } }),
    bulkOrderLeads: await db.bulkOrderLead.count({ where: { OR: [{ email }, { phone: person.phone }] } }),
    newsletter: await db.newsletterSubscriber.count({ where: { email } }),
    whatsapp: await db.whatsAppOptIn.count({ where: { phone: person.phone } }),
    backInStock: await db.backInStockSubscription.count({ where: { email } }),
    enrollments: await db.journeyEnrollment.count({ where: { OR: [{ email }, { phone: person.phone }] } }),
    journeyEvents: await db.journeyEvent.count({ where: { recipient: email } }),
    campaignDeliveries: await db.campaignDelivery.count({ where: { recipient: email } }),
    emailOutbox: await db.emailOutbox.count({ where: { to: email } }),
    adminNotifications: await db.adminNotification.count({
      where: { OR: [{ title: { contains: person.email, mode: "insensitive" } }, { body: { contains: person.email, mode: "insensitive" } }, { metadata: { contains: person.email, mode: "insensitive" } }] },
    }),
    carts: await db.cartAbandonmentEvent.count({ where: { email } }),
    orderEvents: await db.orderEvent.count({ where: { OR: [{ email }, { phone: person.phone }] } }),
    redemptions: await db.discountRedemption.count({ where: { email } }),
  };
}

after(async () => {
  // Rows left behind by these tests are all uniquely tagged; tidy the ones
  // that survive an erasure (anonymised orders) and the catalogue fixtures.
  await db.orderItem.deleteMany({ where: { order: { number: { startsWith: "DK-TEST-" } } } }).catch(() => {});
  await db.discountRedemption.deleteMany({ where: { order: { number: { startsWith: "DK-TEST-" } } } }).catch(() => {});
  await db.order.deleteMany({ where: { number: { startsWith: "DK-TEST-" } } }).catch(() => {});
  await db.discount.deleteMany({ where: { code: { startsWith: "PRIV" } } }).catch(() => {});
  await db.customerJourney.deleteMany({ where: { slug: { startsWith: "privacy-journey-" } } }).catch(() => {});
  await db.campaign.deleteMany({ where: { name: { startsWith: "Privacy campaign " } } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: { startsWith: "privacy-product-" } } }).catch(() => {});
  await db.category.deleteMany({ where: { slug: { startsWith: "privacy-cat-" } } }).catch(() => {});
  await db.emailOutbox.deleteMany({ where: { to: { startsWith: "privacy-" } } }).catch(() => {});
  await db.newsletterSubscriber.deleteMany({ where: { email: { startsWith: "privacy-" } } }).catch(() => {});
});

describe("personal-data export (F-315)", () => {
  let person: Person;
  before(async () => {
    person = await seedPerson("export");
  });

  it("gathers a customer's data from every table, matching the guest order by address case-insensitively", async () => {
    const data = await exportPersonalData({ customerId: person.customer.id }, { audience: "admin" });

    assert.equal(data.subject.customerId, person.customer.id);
    assert.ok(data.subject.emails.includes(person.email));
    assert.deepEqual((data.account as { email: string }).email, person.email);
    assert.equal(data.addresses.length, 1);
    assert.equal(data.orders.length, 2, "the account's order and the guest order placed with the same address");
    assert.equal(data.reviews.length, 1);
    assert.equal(data.wishlist.length, 1);
    assert.equal(data.newsletter.length, 1);
    assert.equal(data.whatsappOptIns.length, 1);
    assert.equal(data.contactEnquiries.length, 1);
    assert.equal(data.bulkOrderLeads.length, 1);
    assert.equal(data.backInStockSignups.length, 1);
    assert.equal(data.discountRedemptions.length, 1);
    assert.equal(data.journeyEnrollments.length, 1);
    assert.equal(data.journeyMessages.length, 1);
    assert.equal(data.campaignMessages.length, 1);
    assert.equal(data.emailLog.length, 1);
    assert.equal(data.abandonedCarts.length, 1);
    assert.equal(data.legacyOrderEvents.length, 1);
    assert.equal(data.adminNotifications.length, 1);
  });

  it("never includes credential material, and keeps staff-only notes out of the shopper's own copy", async () => {
    const own = await exportPersonalData({ customerId: person.customer.id }, { audience: "customer" });
    const json = JSON.stringify(own);
    assert.ok(!json.includes("passwordHash"));
    assert.ok(!json.includes("accessTokenHash"));
    assert.ok(!json.includes("tokenHash"));
    assert.ok(!json.includes("Called the customer"), "internal admin notes are not for the shopper");
    assert.equal(own.adminNotifications.length, 0, "internal alerts are admin-only");
    assert.ok(json.includes("Leave at the gate"), "the shopper's own delivery note is theirs");

    const admin = await exportPersonalData({ customerId: person.customer.id }, { audience: "admin" });
    assert.ok(JSON.stringify(admin).includes("Called the customer"));
  });

  it("exports a person who has no account by email alone", async () => {
    const guest = `privacy-guest-${uid()}@example.com`;
    await db.contactEnquiry.create({ data: { name: "Guest", email: guest, message: "Hello" } });
    const data = await exportPersonalData({ email: guest }, { audience: "admin" });
    assert.equal(data.subject.customerId, null);
    assert.equal(data.account, null);
    assert.equal(data.contactEnquiries.length, 1);
  });

  it("requires something to match on", async () => {
    await assert.rejects(() => exportPersonalData({}, { audience: "admin" }), /required/i);
  });
});

describe("personal-data erasure (F-315)", () => {
  it("removes the person from every table, anonymises (never deletes) their orders, and leaves bystanders alone", async () => {
    const person = await seedPerson("erase");
    const bystander = await seedPerson("bystander");
    const adminId = await findAnyAdminId();

    const report = await erasePersonalData({ customerId: person.customer.id }, { actorUserId: adminId, source: "admin" });

    assert.equal(report.customerDeleted, true);
    const remaining = await remainingRows({ email: person.email, phone: person.phone, customerId: person.customer.id });
    // Orders keep a row each — anonymised — so none still carries the email.
    assert.deepEqual(remaining, {
      customer: 0, addresses: 0, tokens: 0, wishlist: 0, reviews: 0, ordersWithEmail: 0, contactEnquiries: 0,
      bulkOrderLeads: 0, newsletter: 0, whatsapp: 0, backInStock: 0, enrollments: 0, journeyEvents: 0,
      campaignDeliveries: 0, emailOutbox: 0, adminNotifications: 0, carts: 0, orderEvents: 0, redemptions: 0,
    });

    // Orders: still there, money and tax figures untouched, person gone.
    for (const original of [person.deliveredOrder, person.guestOrder]) {
      const order = await db.order.findUniqueOrThrow({ where: { id: original.id }, include: { items: true } });
      assert.equal(order.email, ERASED_EMAIL);
      assert.equal(order.phone, null);
      assert.equal(order.notes, null);
      assert.equal(order.adminNotes, null);
      assert.equal(order.accessTokenHash, null, "the guest-access link is revoked");
      assert.equal(order.customerId, null);
      assert.equal(Number(order.total), Number(original.total));
      assert.equal(order.invoiceNumber, original.invoiceNumber);
      assert.equal(order.number, original.number);
      assert.equal(order.items.length, 1, "line items stay for the tax records");
      assert.deepEqual(order.shippingAddress, {
        name: "Erased customer", line1: "", line2: "", city: "", state: "Telangana", pincode: "500032", country: "IN",
      });
    }

    // The redemption stays (the code's used-count must not change) but is no longer theirs.
    const redemption = await db.discountRedemption.findUniqueOrThrow({ where: { orderId: person.deliveredOrder.id } });
    assert.equal(redemption.email, ERASED_EMAIL);
    assert.equal(redemption.customerId, null);
    assert.equal((await db.discount.findUniqueOrThrow({ where: { id: person.discount.id } })).redeemedCount, 1);

    // The bystander is untouched.
    const still = await remainingRows({ email: bystander.email, phone: bystander.phone, customerId: bystander.customer.id });
    assert.equal(still.customer, 1);
    assert.equal(still.contactEnquiries, 1);
    assert.equal(still.emailOutbox, 1);
    assert.equal(still.adminNotifications, 1);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: bystander.deliveredOrder.id } })).email, bystander.email);

    // The audit row records that it happened — and who — never the address.
    const audit = await db.auditLog.findFirst({
      where: { action: "erase", entityId: person.customer.id },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "an audit row for the erasure");
    assert.equal(audit.userId, adminId);
    assert.ok(!(audit.metadata ?? "").includes(person.email));
    assert.ok(!(audit.metadata ?? "").includes(person.phone));
    assert.equal((JSON.parse(audit.metadata!) as { counts: Record<string, number> }).counts.customers, 1);
  });

  it("is idempotent — a repeated request finds nothing and does not throw", async () => {
    const person = await seedPerson("repeat");
    await erasePersonalData({ customerId: person.customer.id }, { source: "self-service" });
    const again = await erasePersonalData({ email: person.email }, { source: "admin" });
    assert.equal(again.customerDeleted, false);
    assert.equal(again.counts.customers, 0);
    assert.equal(again.counts.contactEnquiries, 0);
  });

  it("refuses while an order is still being fulfilled, naming it, and works once it is delivered — or when overridden", async () => {
    const person = await seedPerson("blocked");
    const open = await createOrder({ email: person.email, customerId: person.customer.id, status: "PROCESSING" });

    await assert.rejects(
      () => erasePersonalData({ customerId: person.customer.id }, { source: "self-service" }),
      (error: unknown) => error instanceof ErasureBlockedError && error.orderNumbers.includes(open.number),
    );
    assert.equal(await db.customer.count({ where: { id: person.customer.id } }), 1, "nothing was erased");

    await db.order.update({ where: { id: open.id }, data: { status: "DELIVERED" } });
    await erasePersonalData({ customerId: person.customer.id }, { source: "self-service" });
    assert.equal(await db.customer.count({ where: { id: person.customer.id } }), 0);

    const other = await seedPerson("override");
    await createOrder({ email: other.email, customerId: other.customer.id, status: "SHIPPED" });
    await erasePersonalData({ customerId: other.customer.id }, { source: "admin", includeOpenOrders: true });
    assert.equal(await db.customer.count({ where: { id: other.customer.id } }), 0);
  });

  it("erases a guest / lead by email alone, including their orders and admin alerts", async () => {
    const guest = `privacy-guestonly-${uid()}@example.com`;
    const order = await createOrder({ email: guest, phone: "9811122233" });
    await db.contactEnquiry.create({ data: { name: "G", email: guest, message: "Hi" } });
    await db.adminNotification.create({ data: { title: "Enquiry", body: `From ${guest}`, type: "bulk_lead_created" } });

    const report = await erasePersonalData({ email: guest }, { source: "admin" });

    assert.equal(report.customerDeleted, false);
    assert.equal(report.counts.contactEnquiries, 1);
    assert.equal(report.counts.adminNotifications, 1);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).email, ERASED_EMAIL);
  });
});

describe("privacy routes without a session", () => {
  const request = (url: string, method = "POST", body: unknown = {}) =>
    new Request(url, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });

  it("the shopper routes answer 401", async () => {
    assert.equal((await accountExport(request("http://localhost/api/account/export", "GET"))).status, 401);
    assert.equal((await accountDelete(request("http://localhost/api/account/delete"))).status, 401);
    assert.equal((await accountEmail(request("http://localhost/api/account/email"))).status, 401);
    assert.equal((await accountMarketingGet()).status, 401);
    assert.equal((await accountMarketingPut(request("http://localhost/api/account/marketing", "PUT", { subscribed: false }))).status, 401);
  });

  it("the admin routes answer 401/403", async () => {
    const params = { params: Promise.resolve({ id: "x" }) };
    for (const response of [
      await adminCustomerExport(request("http://localhost/x", "GET"), params),
      await adminCustomerErase(request("http://localhost/x"), params),
      await adminPrivacyExport(request("http://localhost/x")),
      await adminPrivacyErase(request("http://localhost/x")),
    ]) {
      assert.ok([401, 403].includes(response.status), `unexpected ${response.status}`);
    }
  });
});

describe("account email change (F-315)", () => {
  async function makeCustomer(label: string) {
    const email = `privacy-${label}-${uid()}@example.com`;
    const customer = await db.customer.create({
      data: { email, name: "Email Changer", passwordHash: await hashPassword("password123"), emailVerifiedAt: new Date() },
    });
    return customer;
  }

  /** Reads the confirmation link out of the sealed outbox body. */
  async function linkSentTo(email: string): Promise<string | null> {
    const row = await db.emailOutbox.findFirst({ where: { to: email, kind: "customer_email_change" }, orderBy: { createdAt: "desc" } });
    if (!row) return null;
    const body = openOutboxBody(row.html, row.text);
    return /https?:\/\/[^\s"<]+\/api\/account\/email\/confirm\?token=[^\s"<]+/.exec(body?.text ?? "")?.[0] ?? null;
  }

  it("signs a token that only this app can read back, and refuses tampered or expired ones", () => {
    const token = signEmailChangeToken({ customerId: "c1", fromEmail: "a@x.com", toEmail: "b@x.com", expiresAt: Date.now() + 60_000 });
    assert.deepEqual(readEmailChangeToken(token), { c: "c1", f: "a@x.com", t: "b@x.com", x: readEmailChangeToken(token)!.x });

    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "c1", f: "a@x.com", t: "attacker@x.com", x: Date.now() + 60_000 })).toString("base64url");
    assert.equal(readEmailChangeToken(`${forged}.${signature}`), null, "a payload swapped under the old signature");
    assert.equal(readEmailChangeToken(`${payload}.${signature}x`), null);
    assert.equal(readEmailChangeToken("garbage"), null);
    assert.equal(readEmailChangeToken(token, Date.now() + 120_000), null, "expired");
  });

  it("emails a sealed confirmation link to the NEW address and changes nothing yet", async () => {
    const customer = await makeCustomer("req");
    const next = `privacy-new-${uid()}@example.com`;

    const result = await requestEmailChange(customer.id, next, "http://localhost:3000");

    assert.deepEqual(result, { ok: true });
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).email, customer.email);
    const row = await db.emailOutbox.findFirstOrThrow({ where: { to: next, kind: "customer_email_change" } });
    assert.ok(!row.html.includes("confirm?token="), "the stored body is sealed — no readable link at rest");
    assert.ok(await linkSentTo(next), "...but the app can still open it to send");
  });

  it("refuses the same address, and answers an address already in use exactly like a free one (no enumeration)", async () => {
    const customer = await makeCustomer("same");
    const other = await makeCustomer("taken");

    assert.deepEqual(await requestEmailChange(customer.id, customer.email.toUpperCase(), "http://localhost"), { ok: false, reason: "same_email" });
    assert.deepEqual(await requestEmailChange(customer.id, other.email, "http://localhost"), { ok: true });
    assert.equal(await db.emailOutbox.count({ where: { to: other.email, kind: "customer_email_change" } }), 0, "nothing is sent to an address that belongs to someone else");
  });

  it("applies the change from the emailed link: new address verified, signed out everywhere, old links revoked, old address told", async () => {
    const customer = await makeCustomer("apply");
    const next = `privacy-applied-${uid()}@example.com`;
    await issueCustomerToken(customer.id, "RESET");
    await requestEmailChange(customer.id, next, "http://localhost:3000");
    const token = new URL((await linkSentTo(next))!).searchParams.get("token")!;

    const result = await confirmEmailChange(token);

    assert.deepEqual(result, { ok: true, alreadyApplied: false });
    const updated = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(updated.email, next);
    assert.ok(updated.emailVerifiedAt);
    assert.equal(updated.sessionVersion, customer.sessionVersion + 1);
    assert.equal(await db.customerToken.count({ where: { customerId: customer.id, type: "RESET", usedAt: null } }), 0);
    assert.equal(await db.emailOutbox.count({ where: { to: customer.email, kind: "customer_email_changed_notice" } }), 1);

    // A scanner pre-opening the link, or a second click, is not an error...
    assert.deepEqual(await confirmEmailChange(token), { ok: true, alreadyApplied: true });
    // ...but a link issued for an address the account no longer has is.
    const stale = signEmailChangeToken({ customerId: customer.id, fromEmail: customer.email, toEmail: "x@example.com", expiresAt: Date.now() + 60_000 });
    assert.equal((await confirmEmailChange(stale)).ok, false);
  });

  it("refuses when the target address was registered by someone else in the meantime", async () => {
    const customer = await makeCustomer("race");
    const next = `privacy-race-${uid()}@example.com`;
    const token = signEmailChangeToken({ customerId: customer.id, fromEmail: customer.email, toEmail: next, expiresAt: Date.now() + 60_000 });
    await db.customer.create({ data: { email: next, name: "Quick", passwordHash: await hashPassword("password123") } });

    const result = await confirmEmailChange(token);

    assert.equal(result.ok, false);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).email, customer.email);
  });

  it("the confirm route redirects: to sign-in on success, to the profile on a bad link", async () => {
    const customer = await makeCustomer("route");
    const next = `privacy-route-${uid()}@example.com`;
    const token = signEmailChangeToken({ customerId: customer.id, fromEmail: customer.email, toEmail: next, expiresAt: Date.now() + 60_000 });

    const good = await accountEmailConfirm(new Request(`http://localhost/api/account/email/confirm?token=${encodeURIComponent(token)}`));
    assert.equal(good.status, 307);
    assert.match(good.headers.get("location") ?? "", /\/account\/login\?returnTo=/);

    const bad = await accountEmailConfirm(new Request("http://localhost/api/account/email/confirm?token=nope"));
    assert.match(bad.headers.get("location") ?? "", /\/account\/profile\?emailChange=invalid/);
    const missing = await accountEmailConfirm(new Request("http://localhost/api/account/email/confirm"));
    assert.match(missing.headers.get("location") ?? "", /emailChange=invalid/);
  });
});

describe("marketing preferences from the account (F-315)", () => {
  it("turning it on goes through double opt-in; turning it off is immediate and cancels active journeys", async () => {
    const email = `privacy-marketing-${uid()}@example.com`;
    assert.equal(await getMarketingStatus(email), "none");

    assert.equal(await setMarketingPreference(email, true), "pending");
    const row = await db.newsletterSubscriber.findUniqueOrThrow({ where: { email } });
    assert.equal(row.confirmedAt, null, "consent is not recorded until the link is clicked");

    await confirmNewsletterSubscriber(row.confirmToken!);
    assert.equal(await getMarketingStatus(email), "subscribed");

    const journey = await db.customerJourney.create({ data: { name: "Marketing prefs", slug: `privacy-journey-${uid()}`, trigger: "newsletter_signup", status: "ACTIVE" } });
    const enrollment = await db.journeyEnrollment.create({ data: { journeyId: journey.id, email, trigger: "newsletter_signup" } });

    assert.equal(await setMarketingPreference(email, false), "unsubscribed");
    assert.equal(await getMarketingStatus(email), "unsubscribed");
    assert.equal((await db.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).status, "CANCELLED");

    // Turning it off for an address that never subscribed is a harmless no-op.
    assert.equal(await setMarketingPreference(`privacy-never-${uid()}@example.com`, false), "none");
  });
});

describe("retention (F-316)", () => {
  const tag = uid();

  it("publishes a schedule: every rule has a period, an action, and a policy-readable subject", () => {
    assert.ok(RETENTION_RULES.length >= 15);
    const ids = new Set(RETENTION_RULES.map((rule) => rule.id));
    assert.equal(ids.size, RETENTION_RULES.length, "rule ids are unique");
    for (const id of ["email-outbox-sent", "admin-notifications", "contact-enquiries", "orders", "audit-log", "newsletter-unsubscribed"]) {
      assert.ok(ids.has(id), `missing rule ${id}`);
    }
    for (const rule of RETENTION_RULES) {
      // 0 means "never kept readable" (the credential sweep) rather than an age.
      assert.ok(rule.maxAgeDays >= 0 && rule.subject.length > 10);
    }
    assert.equal(formatRetentionPeriod(90), "90 days");
    assert.equal(formatRetentionPeriod(180), "6 months");
    assert.equal(formatRetentionPeriod(365), "12 months");
    assert.equal(formatRetentionPeriod(395), "13 months");
    assert.equal(formatRetentionPeriod(730), "2 years");
    assert.equal(formatRetentionPeriod(1095), "3 years");
    assert.equal(formatRetentionPeriod(2192), "6 years");
  });

  it("deletes or anonymises what is past its limit, keeps what is not, and never touches order figures", async () => {
    const old = (email: string) => ({ email: `privacy-ret-${tag}-${email}@example.com` });
    const keepEmail = `privacy-ret-${tag}-keep@example.com`;

    // --- past the limit
    const oldOutboxSent = await db.emailOutbox.create({ data: { to: old("a").email, subject: "s", html: "<p>x</p>", kind: "k", status: "SENT", createdAt: daysAgo(100) } });
    const stuckOutbox = await db.emailOutbox.create({ data: { to: old("b").email, subject: "s", html: "<p>secret-body</p>", kind: "k", status: "PENDING", createdAt: daysAgo(70) } });
    const oldNotification = await db.adminNotification.create({ data: { title: "t", body: old("c").email, type: "x", createdAt: daysAgo(400) } });
    const journey = await db.customerJourney.create({ data: { name: "Retention", slug: `privacy-journey-${tag}`, trigger: "t" } });
    const oldJourneyEvent = await db.journeyEvent.create({ data: { journeyId: journey.id, trigger: "t", channel: "EMAIL", recipient: old("d").email, createdAt: daysAgo(400) } });
    const finishedEnrollment = await db.journeyEnrollment.create({
      data: { journeyId: journey.id, email: old("e").email, phone: "9000000001", trigger: "t", status: "COMPLETED", context: '{"firstName":"X"}', updatedAt: daysAgo(400) },
    });
    const activeEnrollment = await db.journeyEnrollment.create({
      data: { journeyId: journey.id, email: old("f").email, trigger: "t", status: "ACTIVE", updatedAt: daysAgo(400) },
    });
    const campaign = await db.campaign.create({ data: { name: `Privacy campaign ${tag}`, channel: "EMAIL" } });
    const oldDelivery = await db.campaignDelivery.create({ data: { campaignId: campaign.id, recipient: old("g").email, channel: "EMAIL", status: "sent", createdAt: daysAgo(400) } });
    const oldCart = await db.cartAbandonmentEvent.create({ data: { email: old("h").email, createdAt: daysAgo(500) } });
    const oldView = await db.productViewEvent.create({ data: { productHandle: `privacy-${tag}`, createdAt: daysAgo(500) } });
    const oldEnquiry = await db.contactEnquiry.create({ data: { name: "Old Enq", email: old("i").email, phone: "9000000002", message: "old message", updatedAt: daysAgo(800) } });
    const oldLead = await db.bulkOrderLead.create({ data: { organization: "Old Org", contactPerson: "Old Person", email: old("j").email, phone: "9000000003", notes: "n", updatedAt: daysAgo(800) } });
    const oldUnsub = await db.newsletterSubscriber.create({ data: { email: old("k").email, unsubscribedAt: daysAgo(400), confirmToken: `ct-${tag}` } });
    const oldOrderEvent = await db.orderEvent.create({ data: { email: old("l").email, phone: "9000000004", createdAt: daysAgo(2300) } });
    const oldOrder = await createOrder({ email: old("m").email, createdAt: daysAgo(2300), total: 4321 });
    const oldCronRun = await db.cronRun.create({ data: { job: `privacy-ret-${tag}`, runKey: "old", createdAt: daysAgo(40) } });
    const expiredToken = await (async () => {
      const customer = await db.customer.create({ data: { email: old("n").email, name: "T", passwordHash: "x" } });
      const row = await db.customerToken.create({ data: { customerId: customer.id, type: "RESET", tokenHash: `th-${tag}`, expiresAt: daysAgo(40) } });
      return { customer, row };
    })();
    const oldAudit = await db.auditLog.create({ data: { action: "x", entity: "privacy_test", createdAt: daysAgo(1200) } });

    // --- inside the limit (must survive untouched)
    const freshOutboxSent = await db.emailOutbox.create({ data: { to: keepEmail, subject: "s", html: "<p>x</p>", kind: "k", status: "SENT", createdAt: daysAgo(10) } });
    const freshPending = await db.emailOutbox.create({ data: { to: keepEmail, subject: "s", html: "<p>wait</p>", kind: "k", status: "PENDING", createdAt: daysAgo(10) } });
    const freshNotification = await db.adminNotification.create({ data: { title: "t", body: keepEmail, type: "x", createdAt: daysAgo(10) } });
    const freshEnquiry = await db.contactEnquiry.create({ data: { name: "Fresh", email: keepEmail, message: "fresh message" } });
    const subscribed = await db.newsletterSubscriber.create({ data: { email: keepEmail, confirmedAt: new Date() } });
    const freshOrder = await createOrder({ email: keepEmail, createdAt: daysAgo(400) });
    const freshAudit = await db.auditLog.create({ data: { action: "x", entity: "privacy_test", createdAt: daysAgo(30) } });

    const result = await runRetention({ rules: RETENTION_RULES });
    assert.ok(result.totalHandled >= 16);
    assert.ok(result.rules.every((rule) => rule.more === false));

    // deleted
    for (const gone of [
      await db.emailOutbox.count({ where: { id: oldOutboxSent.id } }),
      await db.adminNotification.count({ where: { id: oldNotification.id } }),
      await db.journeyEvent.count({ where: { id: oldJourneyEvent.id } }),
      await db.cartAbandonmentEvent.count({ where: { id: oldCart.id } }),
      await db.productViewEvent.count({ where: { id: oldView.id } }),
      await db.cronRun.count({ where: { id: oldCronRun.id } }),
      await db.customerToken.count({ where: { id: expiredToken.row.id } }),
      await db.auditLog.count({ where: { id: oldAudit.id } }),
    ]) {
      assert.equal(gone, 0);
    }

    // given-up emails: not sendable, body gone (the row ages out later)
    const stuck = await db.emailOutbox.findUniqueOrThrow({ where: { id: stuckOutbox.id } });
    assert.equal(stuck.status, "EXPIRED");
    assert.equal(stuck.html, "[body redacted]");

    // anonymised in place
    const enrollment = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: finishedEnrollment.id } });
    assert.deepEqual([enrollment.email, enrollment.phone, enrollment.context], [null, null, "{}"]);
    const stillActive = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: activeEnrollment.id } });
    assert.ok(stillActive.email, "a running journey keeps its recipient, however old");

    const delivery = await db.campaignDelivery.findUniqueOrThrow({ where: { id: oldDelivery.id } });
    assert.equal(delivery.recipient, `erased:${oldDelivery.id}`);
    assert.equal(delivery.status, "sent", "the campaign's sent count survives");

    const enquiry = await db.contactEnquiry.findUniqueOrThrow({ where: { id: oldEnquiry.id } });
    assert.deepEqual([enquiry.email, enquiry.phone, enquiry.message, enquiry.name], [`erased+${oldEnquiry.id}@invalid`, null, "[erased]", "Erased"]);
    const lead = await db.bulkOrderLead.findUniqueOrThrow({ where: { id: oldLead.id } });
    assert.deepEqual([lead.email, lead.phone, lead.notes, lead.contactPerson], [`erased+${oldLead.id}@invalid`, "", null, "Erased"]);
    const unsub = await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: oldUnsub.id } });
    assert.equal(unsub.email, `erased+${oldUnsub.id}@invalid`);
    assert.equal(unsub.confirmToken, null);
    const orderEvent = await db.orderEvent.findUniqueOrThrow({ where: { id: oldOrderEvent.id } });
    assert.deepEqual([orderEvent.email, orderEvent.phone], [null, null]);

    // orders past the tax floor: person gone, figures kept
    const order = await db.order.findUniqueOrThrow({ where: { id: oldOrder.id }, include: { items: true } });
    assert.equal(order.email, ERASED_EMAIL);
    assert.equal(order.phone, null);
    assert.equal(order.accessTokenHash, null);
    assert.equal(Number(order.total), 4321);
    assert.equal(order.invoiceNumber, oldOrder.invoiceNumber);
    assert.equal(order.items.length, 1);

    // inside the limit: untouched
    assert.equal(await db.emailOutbox.count({ where: { id: freshOutboxSent.id } }), 1);
    assert.equal((await db.emailOutbox.findUniqueOrThrow({ where: { id: freshPending.id } })).status, "PENDING");
    assert.equal(await db.adminNotification.count({ where: { id: freshNotification.id } }), 1);
    assert.equal((await db.contactEnquiry.findUniqueOrThrow({ where: { id: freshEnquiry.id } })).email, keepEmail);
    assert.equal((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: subscribed.id } })).email, keepEmail);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: freshOrder.id } })).email, keepEmail, "a 13-month-old order keeps its data");
    assert.equal(await db.auditLog.count({ where: { id: freshAudit.id } }), 1);

    // Safe to run again: nothing of ours matches a second time.
    const second = await runRetention({ rules: RETENTION_RULES });
    assert.equal((await db.contactEnquiry.findUniqueOrThrow({ where: { id: oldEnquiry.id } })).email, `erased+${oldEnquiry.id}@invalid`);
    assert.ok(second.totalHandled < result.totalHandled);

    await db.customer.deleteMany({ where: { id: expiredToken.customer.id } });
    await db.auditLog.deleteMany({ where: { entity: "privacy_test" } });
    await db.productViewEvent.deleteMany({ where: { productHandle: `privacy-${tag}` } });
  });

  it("cleans up credential bodies queued before sealing existed: delivered ones are blanked, waiting ones sealed so they can still be sent", async () => {
    const link = `https://example.test/account/reset-password?token=legacy${tag}`;
    const make = (kind: string, status: "SENT" | "PENDING" | "FAILED", html: string) =>
      db.emailOutbox.create({ data: { to: `privacy-legacy-${tag}-${uid()}@example.com`, subject: "s", html, text: link, kind, status } });

    const sent = await make("customer_reset_password", "SENT", `<a href="${link}">Reset</a>`);
    const failed = await make("order_confirmation_customer", "FAILED", `<a href="${link}">View</a>`);
    const waiting = await make("customer_verify_email", "PENDING", `<a href="${link}">Verify</a>`);
    const alreadySealed = await make("customer_reset_password", "PENDING", "sealed:v1:already");
    const plain = await make("order_confirmation_admin", "SENT", "<p>admin copy, no credential</p>");

    await runRetention({ rules: RETENTION_RULES.filter((rule) => rule.id === "email-outbox-credentials") });

    for (const row of [sent, failed]) {
      const after = await db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.html, "[body redacted]");
      assert.equal(after.text, null);
    }
    const sealed = await db.emailOutbox.findUniqueOrThrow({ where: { id: waiting.id } });
    assert.ok(!sealed.html.includes(link) && !JSON.stringify(sealed).includes(`legacy${tag}`), "no readable token at rest");
    assert.deepEqual(openOutboxBody(sealed.html, sealed.text), { html: `<a href="${link}">Verify</a>`, text: link }, "still deliverable");
    assert.equal((await db.emailOutbox.findUniqueOrThrow({ where: { id: alreadySealed.id } })).html, "sealed:v1:already");
    assert.equal((await db.emailOutbox.findUniqueOrThrow({ where: { id: plain.id } })).html, "<p>admin copy, no credential</p>");
  });

  it("one failing rule does not stop the others, and a run where everything failed is reported as a failure", async () => {
    const failing = { id: "boom", subject: "x".repeat(12), action: "delete" as const, maxAgeDays: 1, run: async () => { throw new Error("table locked"); } };
    const working = { id: "fine", subject: "y".repeat(12), action: "delete" as const, maxAgeDays: 1, run: async () => 3 };

    const mixed = await runRetention({ rules: [failing, working], batchSize: 100 });
    assert.equal(mixed.rules[0].error, "table locked");
    assert.equal(mixed.rules[1].handled, 3);
    assert.equal(mixed.rules[1].error, undefined);

    await assert.rejects(() => runRetention({ rules: [failing, failing] }), /table locked/);
  });

  it("works through a backlog in bounded batches and stops on its time budget with the rest left for tomorrow", async () => {
    const notificationRule = RETENTION_RULES.filter((rule) => rule.id === "admin-notifications");
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await db.adminNotification.create({ data: { title: "backlog", body: `privacy-backlog-${tag}-${i}`, type: "x", createdAt: daysAgo(400) } })).id);
    }

    const starved = await runRetention({ rules: notificationRule, budgetMs: -1 });
    assert.equal(starved.rules[0].handled, 0);
    assert.equal(starved.rules[0].more, true, "out of time — the next run continues");
    assert.equal(await db.adminNotification.count({ where: { id: { in: ids } } }), 5);

    const batched = await runRetention({ rules: notificationRule, batchSize: 2 });
    assert.ok(batched.rules[0].handled >= 5);
    assert.equal(await db.adminNotification.count({ where: { id: { in: ids } } }), 0, "three batches of two cleared five rows");
  });

  describe("POST /api/cron/retention", () => {
    const SECRET = "retention-cron-test-secret";
    const call = (headers: Record<string, string> = {}) => cronRetention(new Request("http://localhost/api/cron/retention", { method: "POST", headers }));

    after(async () => {
      await db.cronRun.deleteMany({ where: { job: "retention" } }).catch(() => {});
    });

    it("rejects an unauthenticated caller", async () => {
      await withEnv({ CRON_SECRET: SECRET }, async () => {
        assert.equal((await call()).status, 401);
        assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
      });
    });

    it("runs the schedule once per day, then answers alreadyRan", async () => {
      await db.cronRun.deleteMany({ where: { job: "retention" } });
      await withEnv({ CRON_SECRET: SECRET }, async () => {
        const first = await call({ authorization: `Bearer ${SECRET}` });
        assert.equal(first.status, 200);
        const body = (await first.json()) as { ok: boolean; rules: { id: string }[]; alreadyRan?: boolean };
        assert.equal(body.ok, true);
        assert.ok(body.rules.some((rule) => rule.id === "orders"));

        const second = await call({ authorization: `Bearer ${SECRET}` });
        assert.equal(((await second.json()) as { alreadyRan?: boolean }).alreadyRan, true);
      });
    });
  });
});
