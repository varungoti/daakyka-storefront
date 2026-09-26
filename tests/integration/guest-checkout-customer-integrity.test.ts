import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";
import { getOrderForAdmin, listOrdersForAdmin } from "@/lib/orders/admin-orders";
import { getCustomerForAdmin, listCustomersForAdmin } from "@/lib/customers/admin-customers";
import { createReview } from "@/lib/reviews/create-review";
import { hashPassword } from "@/lib/customer-auth/password";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { verifyEmailToken } from "@/lib/customer-auth/verify-email";
import { POST as postRegister } from "@/app/api/account/register/route";
import { POST as postLogin } from "@/app/api/account/login/route";

/**
 * Release-hardening F-01 / plan item 1.4: "Guest checkout auto-creates a
 * disconnected, fake customer record" (docs/audit-2026-09-19/admin-ux.md).
 *
 * End-to-end coverage for the chosen fix (option (a) — guest checkout
 * never creates a Customer row; Order.email/phone/shippingAddress are the
 * self-contained record of a guest's real contact details):
 *   1. a guest checkout persists the shopper's real email/phone/name and
 *      creates no fabricated customer;
 *   2. the admin-facing order view (list + detail) exposes those details;
 *   3. /admin/customers never shows a phantom row, and a real customer's
 *      order-count/spend figures stay correct;
 *   4. a registered customer who later claims a prior guest order (via
 *      linkGuestOrdersToCustomer, src/lib/orders/claim-guest-orders.ts)
 *      sees it reflected in both the admin aggregate and
 *      verifiedPurchase;
 *   5. a registered-customer checkout (customerId set at creation time,
 *      the pre-existing path) still links correctly and verifiedPurchase
 *      still resolves.
 */

const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdReviewIds: string[] = [];

after(async () => {
  if (createdReviewIds.length > 0) {
    await db.review.deleteMany({ where: { id: { in: createdReviewIds } } }).catch(() => {});
  }
  if (createdOrderIds.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createActiveProductWithVariant() {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `F01 Category ${unique}`, slug: `f01-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: { name: `F01 Product ${unique}`, slug: `f01-product-${unique}`, categoryId: category.id, status: "ACTIVE", price: 900 },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: { productId: product.id, sku: `DK-F01-${unique}`, size: "M", color: "Navy", stock: 10, active: true },
  });

  return { product, variant };
}

describe("F-01: guest checkout never mints a fabricated Customer", () => {
  it("persists the shopper's real email/phone/name on the order and creates zero Customer rows", async () => {
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `uxaudit-${unique}@example.com`;
    const phone = "9550000000";
    const name = `UX Audit Tester ${unique}`;

    const before = await db.customer.count({ where: { OR: [{ email }, { name }] } });
    assert.equal(before, 0);

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      phone,
      shippingAddress: { name, line1: "1 Audit Street", city: "Hyderabad", state: "Telangana", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(order.id);

    // The order itself carries the real, exact values typed at checkout.
    assert.equal(order.email, email);
    const dbOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(dbOrder.phone, phone);
    assert.equal(dbOrder.customerId, null);
    const storedAddress = dbOrder.shippingAddress as unknown as { name: string };
    assert.equal(storedAddress.name, name);

    // No Customer row was fabricated — neither under the real email/name,
    // nor anywhere else (total count unaffected by this specific pair).
    const after = await db.customer.count({ where: { OR: [{ email }, { name }] } });
    assert.equal(after, 0, "guest checkout must never create a Customer row");
  });

  it("exposes the guest's real name/email/phone on both the admin order list and detail views", async () => {
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `admin-view-${unique}@example.com`;
    const phone = "9550000001";
    const name = `Admin View Guest ${unique}`;

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      phone,
      shippingAddress: { name, line1: "1 Audit Street", city: "Hyderabad", state: "Telangana", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(order.id);

    const detail = await getOrderForAdmin(order.id);
    assert.equal(detail.customerId, null);
    assert.equal(detail.customerName, null, "customerName must stay null — there is no linked account");
    assert.equal(detail.guestName, name, "guestName must be the shopper's real typed name");
    assert.equal(detail.email, email);
    assert.equal(detail.phone, phone);

    const list = await listOrdersForAdmin({ search: email });
    const row = list.items.find((o) => o.id === order.id);
    assert.ok(row, "the guest order should appear in the admin orders list");
    assert.equal(row!.customerName, null);
    assert.equal(row!.guestName, name);
    assert.equal(row!.email, email);
    assert.equal(row!.phone, phone);
  });

  it("never appears in /admin/customers, and a real customer's figures stay correct alongside it", async () => {
    const unique = randomUUID().slice(0, 8);

    // A real registered customer with one PAID order (established pattern
    // from tests/integration/customers-admin.test.ts).
    const realCustomer = await db.customer.create({
      data: { email: `real-${unique}@example.com`, name: "Real Registered Customer", passwordHash: "x", emailVerifiedAt: new Date() },
    });
    createdCustomerIds.push(realCustomer.id);
    const realOrder = await db.order.create({
      data: {
        number: `DK-F01-REAL-${unique}`,
        customerId: realCustomer.id,
        email: realCustomer.email,
        shippingAddress: { name: realCustomer.name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
        subtotal: 1200,
        shipping: 0,
        discount: 0,
        total: 1200,
        currency: "INR",
        status: "PAID",
        paymentMethod: "RAZORPAY",
      },
    });
    createdOrderIds.push(realOrder.id);

    // A guest order placed around the same time, unrelated to the above.
    const { variant } = await createActiveProductWithVariant();
    const guestEmail = `guest-alongside-${unique}@example.com`;
    const guestName = `Guest Alongside ${unique}`;
    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: guestEmail,
      shippingAddress: { name: guestName, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);

    // The guest never shows up as a "customer" under either identity.
    const byGuestEmail = await listCustomersForAdmin({ search: guestEmail });
    assert.equal(byGuestEmail.items.length, 0);
    const byGuestName = await listCustomersForAdmin({ search: guestName });
    assert.equal(byGuestName.items.length, 0);

    // The real customer's own figures are untouched by the guest order
    // existing alongside it — no "0 orders / ₹0 spent" confusion, and no
    // cross-contamination the other way either.
    const realList = await listCustomersForAdmin({ search: realCustomer.email });
    const realItem = realList.items.find((c) => c.id === realCustomer.id);
    assert.ok(realItem);
    assert.equal(realItem!.orderCount, 1);
    assert.equal(realItem!.totalSpent, 1200);

    const realDetail = await getCustomerForAdmin(realCustomer.id);
    assert.equal(realDetail.orderCount, 1);
    assert.equal(realDetail.totalSpent, 1200);
  });
});

describe("F-01: claiming prior guest orders on registration", () => {
  it("linkGuestOrdersToCustomer attaches a PROCESSING guest order so it counts toward spend and verifiedPurchase", async () => {
    const { product, variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `claim-flow-${unique}@example.com`;
    const name = `Claim Flow Guest ${unique}`;

    // Placed as a guest, before any account existed — ORDER_REQUEST orders
    // go straight to PROCESSING (see create-order.ts), which already
    // counts as "purchased" for both spend (admin-customers.ts) and
    // verifiedPurchase (reviews/eligibility.ts).
    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      shippingAddress: { name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);
    assert.equal(guestOrder.status, "PROCESSING");

    // The shopper now registers a real account with the same email and
    // verifies it. This calls the claim directly, on an already-verified
    // account, to isolate its effect from the routes; the suite below
    // covers POST /api/account/register and verifyEmailToken invoking it.
    const customer = await db.customer.create({
      data: { email, name, passwordHash: "x", emailVerifiedAt: new Date() },
    });
    createdCustomerIds.push(customer.id);

    const linkedCount = await linkGuestOrdersToCustomer(customer.id, customer.email);
    assert.equal(linkedCount, 1);

    const claimedOrder = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(claimedOrder.customerId, customer.id);
    // The claim never rewrites the order's own real contact fields.
    assert.equal(claimedOrder.email, email);

    const detail = await getCustomerForAdmin(customer.id);
    assert.equal(detail.orderCount, 1);
    assert.equal(detail.totalSpent, Number(guestOrder.total));

    const review = await createReview({
      customerId: customer.id,
      productId: product.id,
      rating: 5,
      title: "Great fit and fabric",
      body: "Exactly as described, would order again for the team.",
    });
    createdReviewIds.push(review.id);
    assert.equal(review.verifiedPurchase, true, "a claimed guest order must count toward verifiedPurchase");
  });
});

describe("F-01: registered-customer checkout is unaffected (regression guard)", () => {
  it("links customerId at creation time and resolves verifiedPurchase without needing a claim", async () => {
    const { product, variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const customer = await db.customer.create({
      data: { email: `registered-checkout-${unique}@example.com`, name: "Registered Shopper", passwordHash: "x" },
    });
    createdCustomerIds.push(customer.id);

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: customer.email,
      shippingAddress: { name: customer.name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      customerId: customer.id,
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(order.id);

    const dbOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(dbOrder.customerId, customer.id, "a logged-in shopper's order must link at creation time");

    const detail = await getOrderForAdmin(order.id);
    assert.equal(detail.customerId, customer.id);
    assert.equal(detail.customerName, customer.name);
    assert.equal(detail.guestName, null, "guestName must stay null once there is a linked customer");

    const review = await createReview({
      customerId: customer.id,
      productId: product.id,
      rating: 4,
      title: "Solid everyday scrubs",
      body: "Comfortable for a full shift, fabric holds up after washing.",
    });
    createdReviewIds.push(review.id);
    assert.equal(review.verifiedPurchase, true);
  });
});

/**
 * The two suites above exercise linkGuestOrdersToCustomer directly. These
 * drive the routes and the verify-email flow that actually call it, so the
 * wiring itself is covered.
 *
 * F-037 rewrite: registering, or merely logging in, is no longer enough to
 * claim — only an account that has proven it owns the email (verified via
 * the emailed token, or a verified login) may. These tests now assert the
 * negative (register claims nothing) alongside the positive (verifying
 * claims, and a verified login claims).
 *
 * Harness limitation (the same one documented at the top of
 * tests/integration/customer-auth.test.ts): calling a route handler
 * outside a real Next.js request makes `cookies()` throw, so
 * createCustomerSession() fails and the route's own try/catch turns the
 * success path into a 500. Both routes' (non-)claim happens *before* that
 * cookie write, so its DB effect is what these assert, accepting either
 * status. That ordering is deliberate rather than incidental: a claim
 * placed after the session write would be skipped by any failure in it.
 */
describe("F-01/F-037: the routes that claim guest orders only do so once the email is verified", () => {
  it("POST /api/account/register does NOT claim a guest order — typing an email is not proof of owning it", async () => {
    await resetRateLimits(["account-register"]);
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    // Mixed case on purpose: the order keeps what the shopper typed, the
    // route lowercases what it stores, and the (non-)claim still has to
    // match case-insensitively once verification does run it.
    const guestEmail = `Register-Claim-${unique}@Example.com`;
    const accountEmail = guestEmail.toLowerCase();
    const name = `Register Claim Guest ${unique}`;

    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: guestEmail,
      shippingAddress: { name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } })).customerId,
      null,
      "precondition: the guest order starts unclaimed",
    );

    const response = await postRegister(
      jsonRequest("http://localhost/api/account/register", "POST", {
        name,
        email: guestEmail,
        password: "password123",
        consentGiven: true,
      }),
    );
    assert.ok([201, 500].includes(response.status), `unexpected status ${response.status}`);

    const customer = await db.customer.findUnique({ where: { email: accountEmail } });
    assert.ok(customer, "the register route should have created the account");
    createdCustomerIds.push(customer!.id);
    assert.equal(customer!.emailVerifiedAt, null, "a fresh registration must not be pre-verified");

    const stillUnclaimed = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(
      stillUnclaimed.customerId,
      null,
      "F-037: POST /api/account/register must never claim an order — registering with an email is not proof of owning it",
    );

    // Now the shopper actually verifies (clicks the emailed link). Only
    // this proves ownership, so only this may claim.
    const { raw } = await issueCustomerToken(customer!.id, "VERIFY");
    const result = await verifyEmailToken(raw);
    assert.equal(result.ok, true);

    const claimed = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(
      claimed.customerId,
      customer!.id,
      "verifying the email must claim any guest order placed before the account existed",
    );
    assert.equal(claimed.email, guestEmail, "the claim must not rewrite the order's own contact details");

    // And it lands where a shopper or admin would actually look for it.
    const detail = await getCustomerForAdmin(customer!.id);
    assert.equal(detail.orderCount, 1);
    assert.equal(detail.totalSpent, Number(guestOrder.total));
  });

  it("POST /api/account/login claims a guest order placed after the account already existed, once verified", async () => {
    await resetRateLimits(["account-login"]);
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `login-claim-${unique}@example.com`;
    const password = "password123";

    // The account is already verified (e.g. it verified at signup time),
    // so a later logged-out checkout (expired session, another device) is
    // exactly the gap login's claim exists to cover.
    const customer = await db.customer.create({
      data: {
        email,
        name: `Login Claim Shopper ${unique}`,
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
    createdCustomerIds.push(customer.id);

    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      shippingAddress: { name: customer.name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } })).customerId,
      null,
      "precondition: checking out logged-out leaves the order unclaimed even though the account exists",
    );

    const response = await postLogin(
      jsonRequest("http://localhost/api/account/login", "POST", { email, password }),
    );
    assert.ok([200, 500].includes(response.status), `unexpected status ${response.status}`);

    const claimed = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(
      claimed.customerId,
      customer.id,
      "signing in to a verified account must pick up a guest order placed since signup",
    );

    const detail = await getCustomerForAdmin(customer.id);
    assert.equal(detail.orderCount, 1);
  });

  it("POST /api/account/login does NOT claim a guest order for an unverified account (F-037)", async () => {
    await resetRateLimits(["account-login"]);
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `login-unverified-${unique}@example.com`;
    const password = "password123";

    // Never verified — e.g. an attacker registered this email and is now
    // logging back in, hoping to collect whatever the real owner ordered
    // as a guest in the meantime.
    const customer = await db.customer.create({
      data: { email, name: `Login Unverified Shopper ${unique}`, passwordHash: await hashPassword(password) },
    });
    createdCustomerIds.push(customer.id);
    assert.equal(customer.emailVerifiedAt, null);

    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      shippingAddress: { name: "Victim Guest Shopper", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);

    const response = await postLogin(
      jsonRequest("http://localhost/api/account/login", "POST", { email, password }),
    );
    assert.ok([200, 500].includes(response.status), `unexpected status ${response.status}`);

    const untouched = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(
      untouched.customerId,
      null,
      "F-037: logging into an unverified account must never claim guest orders placed under its email",
    );
  });

  it("a failed login claims nothing, so the claim sits behind the credential check", async () => {
    await resetRateLimits(["account-login"]);
    const { variant } = await createActiveProductWithVariant();
    const unique = randomUUID().slice(0, 8);
    const email = `login-denied-${unique}@example.com`;

    const customer = await db.customer.create({
      data: { email, name: `Login Denied Shopper ${unique}`, passwordHash: await hashPassword("password123") },
    });
    createdCustomerIds.push(customer.id);

    const guestOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      shippingAddress: { name: customer.name, line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500032", country: "IN" },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(guestOrder.id);

    const response = await postLogin(
      jsonRequest("http://localhost/api/account/login", "POST", { email, password: "not-the-password" }),
    );
    assert.equal(response.status, 401);

    const untouched = await db.order.findUniqueOrThrow({ where: { id: guestOrder.id } });
    assert.equal(
      untouched.customerId,
      null,
      "knowing an email must never be enough to attach its orders to an account",
    );
  });
});
