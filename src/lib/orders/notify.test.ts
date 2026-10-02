import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { openOutboxBody } from "@/lib/engagement/outbox-seal";
import { notifyNewOrder } from "@/lib/orders/notify";

/**
 * Release-hardening batch 3a, F-073: the seeded "Post-Purchase Journey"
 * (trigger `order_created`) used to only ever fire from the legacy Shopify
 * order webhook — every native order path (checkout, verify, the Razorpay
 * webhook) calls notifyNewOrder, and none of them triggered a journey.
 * notifyNewOrder now does, itself, so every caller gets this for free.
 */

describe("notifyNewOrder (F-073: order_created journey trigger)", () => {
  const createdJourneyIds: string[] = [];

  after(async () => {
    if (createdJourneyIds.length > 0) {
      await db.customerJourney.deleteMany({ where: { id: { in: createdJourneyIds } } }).catch(() => {});
    }
    // notifyNewOrder's own (unrelated to this fix) email sends land PENDING
    // rows in the shared EmailOutbox table via sendTransactionalEmail.
    await db.emailOutbox.deleteMany({ where: { to: { contains: "notify-order-created-" } } }).catch(() => {});
  });

  it("enrolls the order's email in an ACTIVE order_created journey, with phone/firstName carried through", async () => {
    const suffix = randomUUID();
    const journey = await db.customerJourney.create({
      data: {
        name: `Test post-purchase journey ${suffix}`,
        slug: `test-post-purchase-${suffix}`,
        trigger: "order_created",
        status: "ACTIVE",
        steps: {
          create: [{ sortOrder: 0, name: "thank-you", delayHours: 0, channel: "ADMIN_NOTIFICATION" }],
        },
      },
    });
    createdJourneyIds.push(journey.id);

    const email = `notify-order-created-${suffix}@example.com`;
    await notifyNewOrder({
      orderId: `test-order-id-${suffix}`,
      orderNumber: `TEST-${suffix.slice(0, 8)}`,
      email,
      total: 999,
      currency: "INR",
      fallback: false,
      phone: "9876543210",
      firstName: "Priya",
    });

    const enrollment = await db.journeyEnrollment.findFirst({ where: { journeyId: journey.id, email } });
    assert.ok(enrollment, "expected an order_created enrollment for this order's email");
    assert.equal(enrollment!.phone, "9876543210");
  });

  it("never throws even if the journey trigger fails (best-effort, matching every other step in notifyNewOrder)", async () => {
    // No ACTIVE order_created journey needs to exist for this to be a no-op
    // — triggerJourneys('order_created', ...) against zero matching
    // journeys just resolves with `{ triggered: 0, enrollments: [] }|`.
    await assert.doesNotReject(() =>
      notifyNewOrder({
        orderId: `test-order-id-${randomUUID()}`,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        email: `notify-order-created-noop-${randomUUID()}@example.com`,
        total: 100,
        currency: "INR",
        fallback: true,
      }),
    );
  });
});

/**
 * F-251: notifyNewOrder is the one place every order path (checkout,
 * /verify, the Razorpay webhook) hands off to for the customer email, the
 * store's own alert and the admin notification, and nothing asserted what it
 * actually queues. The renderers have their own tests
 * (order-email.test.ts); this covers the decisions notifyNewOrder itself
 * makes: which rows exist, who they go to, which link the customer gets, and
 * what is passed through for a paid-but-sold-out order.
 */
describe("notifyNewOrder: what it queues (F-251)", () => {
  const prefix = `NOTIFYQ-${randomUUID().slice(0, 6)}`;
  const orderNumbers: string[] = [];
  const emails: string[] = [];
  let previousContactEmail: { existed: boolean; value?: unknown } | null = null;

  function input(overrides: Partial<Parameters<typeof notifyNewOrder>[0]> = {}) {
    const suffix = randomUUID().slice(0, 8);
    const orderNumber = `${prefix}-${suffix}`;
    const email = `notify-queue-${suffix}@example.com`;
    orderNumbers.push(orderNumber);
    emails.push(email);
    return {
      orderId: `test-order-id-${suffix}`,
      orderNumber,
      email,
      total: 1499,
      currency: "INR",
      fallback: false,
      ...overrides,
    };
  }

  after(async () => {
    await db.emailOutbox.deleteMany({ where: { OR: [{ to: { in: emails } }, { subject: { contains: prefix } }] } }).catch(() => {});
    await db.adminNotification.deleteMany({ where: { OR: orderNumbers.map((n) => ({ metadata: { contains: n } })) } }).catch(() => {});
    if (previousContactEmail) {
      if (previousContactEmail.existed) {
        await db.siteSetting
          .update({ where: { key: "contact.email" }, data: { value: previousContactEmail.value as string } })
          .catch(() => {});
      } else {
        await db.siteSetting.deleteMany({ where: { key: "contact.email" } }).catch(() => {});
      }
    }
  });

  async function customerEmailFor(email: string) {
    const rows = await db.emailOutbox.findMany({ where: { to: email, kind: "order_confirmation_customer" } });
    assert.equal(rows.length, 1, "expected exactly one customer confirmation email");
    const row = rows[0]!;
    const body = openOutboxBody(row.html, row.text);
    assert.ok(body, "the sealed customer email must be readable by the running app");
    return { row, body: body! };
  }

  it("an order request: one customer email linking to the tokenised order page, one order_request notification", async () => {
    const call = input({ fallback: true, orderToken: "raw-access-token_1.2" });
    await notifyNewOrder(call);

    const { row, body } = await customerEmailFor(call.email);
    assert.equal(row.subject, `We received your order ${call.orderNumber}`);
    assert.ok(!row.html.includes("?token="), "the stored body is sealed — the order link is a live credential");
    assert.ok(body.html.includes(`/order/${call.orderNumber}?token=raw-access-token_1.2`), "the email links with the order's own token");
    assert.ok(body.text?.includes(`/order/${call.orderNumber}?token=raw-access-token_1.2`), "...in the plain-text part too");

    const notifications = await db.adminNotification.findMany({ where: { metadata: { contains: call.orderNumber } } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.type, "order_request");
    assert.equal(notifications[0]!.title, `New order ${call.orderNumber}`);
    assert.ok(notifications[0]!.body.includes(call.email));
    assert.ok(notifications[0]!.body.includes("order request, payment pending"));
  });

  it("a paid order that has no raw token still gets a working signed link, and an order_paid notification", async () => {
    // The Razorpay webhook never sees the raw token, only its hash.
    const call = input({ fallback: false });
    await notifyNewOrder(call);

    const { row, body } = await customerEmailFor(call.email);
    assert.equal(row.subject, `Payment received — order ${call.orderNumber}`);
    assert.ok(body.html.includes(`/order/${call.orderNumber}?sig=`), "falls back to a signed link");
    assert.ok(!body.html.includes("?token="));

    const [notification] = await db.adminNotification.findMany({ where: { metadata: { contains: call.orderNumber } } });
    assert.ok(notification);
    assert.equal(notification.type, "order_paid");
    assert.ok(notification.body.includes("(paid)"));
  });

  it("queues the store's own alert to the contact.email setting, linking to the order in the admin", async () => {
    const existing = await db.siteSetting.findUnique({ where: { key: "contact.email" } });
    previousContactEmail = { existed: Boolean(existing), value: existing?.value };
    const storeAddress = `store-alerts-${randomUUID().slice(0, 8)}@example.com`;
    await db.siteSetting.upsert({
      where: { key: "contact.email" },
      create: { key: "contact.email", value: storeAddress },
      update: { value: storeAddress },
    });
    emails.push(storeAddress);

    const call = input({ fallback: true });
    await notifyNewOrder(call);

    const alerts = await db.emailOutbox.findMany({ where: { kind: "order_confirmation_admin", subject: { contains: call.orderNumber } } });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.to, storeAddress);
    assert.ok(alerts[0]!.subject.includes("order request"));
    assert.ok(alerts[0]!.html.includes(`/admin/orders/${call.orderId}`));
  });

  it("a paid order that lost the stock race is described honestly and never promises shipment", async () => {
    const call = input({ fallback: false, stockConflict: true });
    await notifyNewOrder(call);

    const { row, body } = await customerEmailFor(call.email);
    assert.equal(row.subject, `Payment received — order ${call.orderNumber} (stock issue)`);
    assert.ok(body.html.includes("sold out"));
    assert.ok(!body.html.includes("as soon as it ships") && !body.text?.includes("as soon as it ships"));
  });
});
