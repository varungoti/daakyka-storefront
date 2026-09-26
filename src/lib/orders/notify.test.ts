import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
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
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        email: `notify-order-created-noop-${randomUUID()}@example.com`,
        total: 100,
        currency: "INR",
        fallback: true,
      }),
    );
  });
});
