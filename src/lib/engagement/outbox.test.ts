import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  computeBackoffMs,
  drainEmailOutbox,
  getUndeliveredEmailCount,
  MAX_ATTEMPTS,
  sendTransactionalEmail,
} from "@/lib/engagement/outbox";
import type { SendEmailInput, SendEmailResult } from "@/lib/engagement/providers/email";

/**
 * F7 fix (docs/audit-2026-09-19/correctness.md): the transactional-email
 * outbox. This environment has no Brevo configured (deliberately — the
 * task constraints require never sending real email here), so
 * sendTransactionalEmail's "not configured" branch is exercised for real,
 * exactly like tests/integration/customer-auth.test.ts's register test
 * already relies on for the "[dev] verification link" log line.
 * drainEmailOutbox's injectable `sendFn` is what exercises "a provider is
 * available" and specific per-message failures without ever touching real
 * Brevo — see its doc comment in src/lib/engagement/outbox.ts.
 *
 * Every drainEmailOutbox call below passes `ids` to scope the batch to
 * rows this file created: the underlying table is shared with every other
 * concurrently-running test file/process (checkout.test.ts and
 * customer-auth.test.ts both create real EmailOutbox rows via
 * notifyNewOrder/sendVerificationEmail), and an unscoped drain would reach
 * into those too.
 */

const createdIds: string[] = [];

function testInput(label: string): SendEmailInput {
  return {
    to: `outbox-test-${label}-${randomUUID().slice(0, 8)}@example.com`,
    subject: `Outbox test ${label}`,
    html: "<p>test</p>",
  };
}

async function createPendingRow() {
  const row = await db.emailOutbox.create({
    data: {
      to: `outbox-test-${randomUUID().slice(0, 8)}@example.com`,
      subject: "Outbox drain test",
      html: "<p>test</p>",
      kind: "test_outbox",
      status: "PENDING",
    },
  });
  createdIds.push(row.id);
  return row;
}

describe("email outbox (F7)", () => {
  after(async () => {
    if (createdIds.length > 0) {
      await db.emailOutbox.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
  });

  describe("computeBackoffMs", () => {
    it("doubles from a 10-minute base and caps at 6 hours", () => {
      assert.equal(computeBackoffMs(1), 10 * 60 * 1000);
      assert.equal(computeBackoffMs(2), 20 * 60 * 1000);
      assert.equal(computeBackoffMs(3), 40 * 60 * 1000);
      assert.equal(computeBackoffMs(6), 320 * 60 * 1000, "5h20m — MAX_ATTEMPTS (6) never actually reaches the cap");
      assert.equal(computeBackoffMs(7), 6 * 60 * 60 * 1000, "capped from attempt 7 on");
      assert.equal(computeBackoffMs(10), 6 * 60 * 60 * 1000, "should cap rather than keep growing");
    });
  });

  describe("sendTransactionalEmail", () => {
    it("lands in the outbox as PENDING — not lost — when no provider is configured", async () => {
      const input = testInput("no-provider");
      const result = await sendTransactionalEmail(input, "test_kind");

      assert.equal(result.ok, false);
      assert.equal(result.provider, "stub");
      assert.ok(result.outboxId, "expected an outboxId even though the send failed");
      createdIds.push(result.outboxId!);

      const row = await db.emailOutbox.findUnique({ where: { id: result.outboxId! } });
      assert.ok(row, "expected an EmailOutbox row to have been created");
      assert.equal(row!.status, "PENDING");
      assert.equal(row!.to, input.to);
      assert.equal(row!.subject, input.subject);
      assert.equal(row!.html, input.html);
      assert.equal(row!.kind, "test_kind");
      // provider:"stub" (never configured) isn't a real attempt against a
      // live provider, so it must not consume the bounded retry budget.
      assert.equal(row!.attemptCount, 0);
      assert.equal(row!.nextAttemptAt, null);
    });
  });

  describe("drainEmailOutbox", () => {
    it("sends and marks SENT when a provider is available (injected fake — never calls Brevo)", async () => {
      const row = await createPendingRow();
      const fakeSend = async (): Promise<SendEmailResult> => ({
        ok: true,
        provider: "brevo",
        messageId: "fake-message-id",
      });

      const result = await drainEmailOutbox({ sendFn: fakeSend, ids: [row.id] });

      assert.equal(result.attempted, 1);
      assert.equal(result.sent, 1);
      assert.equal(result.failedTerminal, 0);
      assert.equal(result.stillPending, 0);

      const updated = await db.emailOutbox.findUnique({ where: { id: row.id } });
      assert.equal(updated!.status, "SENT");
      assert.ok(updated!.sentAt);
      assert.equal(updated!.providerMessageId, "fake-message-id");
    });

    it("stops without burning an attempt when the provider reports it isn't configured", async () => {
      const row = await createPendingRow();
      const fakeStub = async (): Promise<SendEmailResult> => ({
        ok: false,
        provider: "stub",
        error: "not configured",
      });

      const result = await drainEmailOutbox({ sendFn: fakeStub, ids: [row.id] });

      assert.equal(result.skippedReason, "provider_not_configured");
      assert.equal(result.sent, 0);
      assert.equal(result.failedTerminal, 0);

      const updated = await db.emailOutbox.findUnique({ where: { id: row.id } });
      assert.equal(updated!.status, "PENDING");
      assert.equal(updated!.attemptCount, 0);
      assert.equal(updated!.nextAttemptAt, null);
    });

    it("bounds retries with backoff and marks FAILED (terminal) after MAX_ATTEMPTS real provider failures", async () => {
      const row = await createPendingRow();
      const fakeFail = async (): Promise<SendEmailResult> => ({
        ok: false,
        provider: "brevo",
        error: "550 mailbox does not exist",
      });

      let now = new Date();
      for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
        // Jump far into the future on each call so the previous attempt's
        // backoff window has always already elapsed — exercises real
        // attempt-count progression without an actual sleep.
        now = new Date(now.getTime() + 100 * 24 * 60 * 60 * 1000);
        const result = await drainEmailOutbox({ sendFn: fakeFail, ids: [row.id], now });
        assert.equal(result.attempted, 1, `attempt ${i} should have been claimed and attempted`);

        const current = await db.emailOutbox.findUnique({ where: { id: row.id } });
        assert.equal(current!.attemptCount, i);

        if (i < MAX_ATTEMPTS) {
          assert.equal(current!.status, "PENDING", `attempt ${i} should still be retryable`);
          assert.ok(current!.nextAttemptAt, `attempt ${i} should have a backoff nextAttemptAt`);
          assert.equal(result.failedTerminal, 0);
        } else {
          assert.equal(current!.status, "FAILED", "should be terminal once MAX_ATTEMPTS is reached");
          assert.equal(result.failedTerminal, 1);
        }
      }

      // Terminal: a permanently-bad address doesn't retry forever, even
      // with time advanced far past any backoff window.
      now = new Date(now.getTime() + 100 * 24 * 60 * 60 * 1000);
      const finalResult = await drainEmailOutbox({ sendFn: fakeFail, ids: [row.id], now });
      assert.equal(finalResult.attempted, 0, "a FAILED row must never be picked up again");
    });

    it("still retries a row left claimed by a stale (crashed-run) lock", async () => {
      const row = await createPendingRow();
      await db.emailOutbox.update({
        where: { id: row.id },
        data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) }, // 1h ago
      });

      const fakeSend = async (): Promise<SendEmailResult> => ({ ok: true, provider: "brevo" });
      const result = await drainEmailOutbox({ sendFn: fakeSend, ids: [row.id] });

      assert.equal(result.sent, 1);
      const updated = await db.emailOutbox.findUnique({ where: { id: row.id } });
      assert.equal(updated!.status, "SENT");
    });

    it("does not touch a row still holding a fresh lock (guards against a concurrent overlapping run)", async () => {
      const row = await createPendingRow();
      await db.emailOutbox.update({ where: { id: row.id }, data: { lockedAt: new Date() } });

      const fakeSend = async (): Promise<SendEmailResult> => ({ ok: true, provider: "brevo" });
      const result = await drainEmailOutbox({ sendFn: fakeSend, ids: [row.id] });

      assert.equal(result.attempted, 0);
      const updated = await db.emailOutbox.findUnique({ where: { id: row.id } });
      assert.equal(updated!.status, "PENDING");
    });
  });

  describe("getUndeliveredEmailCount", () => {
    it("counts PENDING and FAILED rows, excluding SENT", async () => {
      const before = await getUndeliveredEmailCount();

      await createPendingRow();
      const failedRow = await db.emailOutbox.create({
        data: {
          to: `outbox-test-failed-${randomUUID().slice(0, 8)}@example.com`,
          subject: "Failed test",
          html: "<p>test</p>",
          kind: "test_outbox",
          status: "FAILED",
          attemptCount: MAX_ATTEMPTS,
        },
      });
      createdIds.push(failedRow.id);
      const sentRow = await db.emailOutbox.create({
        data: {
          to: `outbox-test-sent-${randomUUID().slice(0, 8)}@example.com`,
          subject: "Sent test",
          html: "<p>test</p>",
          kind: "test_outbox",
          status: "SENT",
          sentAt: new Date(),
        },
      });
      createdIds.push(sentRow.id);

      const afterCounts = await getUndeliveredEmailCount();
      assert.equal(afterCounts.pending, before.pending + 1);
      assert.equal(afterCounts.failed, before.failed + 1);
      assert.equal(afterCounts.total, before.total + 2);
    });
  });
});
