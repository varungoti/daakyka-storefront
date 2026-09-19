import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/drain-email-outbox/route";
import { withEnv } from "../helpers/env";

/**
 * F7 fix (docs/audit-2026-09-19/correctness.md): the HTTP layer of the
 * drain-email-outbox cron — authorizeCron gating and CronRun idempotency,
 * mirroring tests/integration/checkout.test.ts's
 * "POST /api/cron/cancel-stale-orders" section exactly.
 *
 * The actual retry/backoff/SENT-marking logic (drainEmailOutbox with an
 * injected fake provider) is exercised at the library layer in
 * src/lib/engagement/outbox.test.ts — this file never injects a fake
 * provider (the route never exposes that seam, by design; see the route's
 * doc comment), so it only ever observes the real environment's Brevo
 * being unconfigured. That's still a meaningful assertion: it proves a
 * PENDING row survives a real drain-cron invocation untouched rather than
 * being lost or marked FAILED just because no provider is configured yet.
 */

const TEST_CRON_SECRET = "email-outbox-cron-test-secret";
const createdIds: string[] = [];

after(async () => {
  if (createdIds.length > 0) {
    await db.emailOutbox.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  }
  await db.cronRun.deleteMany({ where: { job: "drain-email-outbox" } }).catch(() => {});
});

describe("POST /api/cron/drain-email-outbox (F7)", () => {
  // The route claims one CronRun row per 15-minute intervalRunKey() bucket
  // (see src/app/api/cron/drain-email-outbox/route.ts), shared across every
  // call in this file since they all run within the same real-time window.
  // Reset it before each test so "first call claims, second is a no-op"
  // assertions don't depend on (or get thrown off by) test execution order.
  beforeEach(async () => {
    await db.cronRun.deleteMany({ where: { job: "drain-email-outbox" } });
  });

  it("401s without the bearer secret", async () => {
    await withEnv({ CRON_SECRET: TEST_CRON_SECRET }, async () => {
      const response = await cronPost(new Request("http://localhost/api/cron/drain-email-outbox"));
      assert.equal(response.status, 401);

      const getResponse = await cronGet(new Request("http://localhost/api/cron/drain-email-outbox"));
      assert.equal(getResponse.status, 401);
    });
  });

  it("leaves a PENDING row untouched (not lost, not FAILED) when the real provider isn't configured", async () => {
    const row = await db.emailOutbox.create({
      data: {
        to: `outbox-cron-test-${randomUUID().slice(0, 8)}@example.com`,
        subject: "Outbox cron test",
        html: "<p>test</p>",
        kind: "test_outbox_cron",
        status: "PENDING",
      },
    });
    createdIds.push(row.id);

    await withEnv({ CRON_SECRET: TEST_CRON_SECRET }, async () => {
      const response = await cronPost(
        new Request("http://localhost/api/cron/drain-email-outbox", {
          headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok: boolean };
      assert.equal(body.ok, true);
    });

    const reloaded = await db.emailOutbox.findUnique({ where: { id: row.id } });
    assert.equal(reloaded!.status, "PENDING");
    assert.equal(reloaded!.attemptCount, 0);
  });

  it("CronRun idempotency: a second call within the same scheduled window is a no-op", async () => {
    await withEnv({ CRON_SECRET: TEST_CRON_SECRET }, async () => {
      const makeRequest = () =>
        new Request("http://localhost/api/cron/drain-email-outbox", {
          headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
        });

      const first = await cronPost(makeRequest());
      assert.equal(first.status, 200);
      const firstBody = (await first.json()) as { ok: boolean; alreadyRan?: boolean };
      assert.equal(firstBody.ok, true);

      const second = await cronPost(makeRequest());
      assert.equal(second.status, 200);
      const secondBody = (await second.json()) as { ok: boolean; alreadyRan?: boolean };
      assert.equal(secondBody.alreadyRan, true, "a duplicate invocation of the same tick should short-circuit");
    });
  });
});
