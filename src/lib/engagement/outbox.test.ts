import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  computeBackoffMs,
  drainEmailOutbox,
  EMAIL_KIND,
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

  // F-044 fix: reset/verify rows now carry a per-kind TTL (expiresAt) and
  // an older PENDING row of the same kind+recipient is expired the moment
  // a newer one is queued, so a customer never receives a dead link once
  // Brevo is (re)enabled after sitting unconfigured.
  describe("expiresAt / superseding (F-044)", () => {
    it("stamps a reset email with an ~1h expiresAt, and a verify email with ~24h", async () => {
      const resetInput = testInput("reset-ttl");
      const resetResult = await sendTransactionalEmail(resetInput, EMAIL_KIND.CUSTOMER_RESET_PASSWORD);
      assert.ok(resetResult.outboxId);
      createdIds.push(resetResult.outboxId!);
      const resetRow = await db.emailOutbox.findUnique({ where: { id: resetResult.outboxId! } });
      assert.ok(resetRow!.expiresAt, "reset row should have an expiresAt");
      const resetTtlMs = resetRow!.expiresAt!.getTime() - resetRow!.createdAt.getTime();
      assert.ok(Math.abs(resetTtlMs - 60 * 60 * 1000) < 5000, `expected ~1h TTL, got ${resetTtlMs}ms`);

      const verifyInput = testInput("verify-ttl");
      const verifyResult = await sendTransactionalEmail(verifyInput, EMAIL_KIND.CUSTOMER_VERIFY_EMAIL);
      assert.ok(verifyResult.outboxId);
      createdIds.push(verifyResult.outboxId!);
      const verifyRow = await db.emailOutbox.findUnique({ where: { id: verifyResult.outboxId! } });
      assert.ok(verifyRow!.expiresAt, "verify row should have an expiresAt");
      const verifyTtlMs = verifyRow!.expiresAt!.getTime() - verifyRow!.createdAt.getTime();
      assert.ok(
        Math.abs(verifyTtlMs - 24 * 60 * 60 * 1000) < 5000,
        `expected ~24h TTL, got ${verifyTtlMs}ms`,
      );
    });

    it("never sets expiresAt on an order-confirmation row — those stay eligible indefinitely", async () => {
      const input = testInput("order-no-ttl");
      const result = await sendTransactionalEmail(input, EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER);
      assert.ok(result.outboxId);
      createdIds.push(result.outboxId!);
      const row = await db.emailOutbox.findUnique({ where: { id: result.outboxId! } });
      assert.equal(row!.expiresAt, null);
    });

    it("queuing a new reset email expires an earlier still-PENDING reset row for the same recipient", async () => {
      const to = `outbox-supersede-${randomUUID().slice(0, 8)}@example.com`;

      const first = await sendTransactionalEmail(
        { to, subject: "Reset 1", html: "<p>1</p>" },
        EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
      );
      assert.ok(first.outboxId);
      createdIds.push(first.outboxId!);
      const firstBefore = await db.emailOutbox.findUnique({ where: { id: first.outboxId! } });
      assert.equal(firstBefore!.status, "PENDING");

      const second = await sendTransactionalEmail(
        { to, subject: "Reset 2", html: "<p>2</p>" },
        EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
      );
      assert.ok(second.outboxId);
      createdIds.push(second.outboxId!);

      const firstAfter = await db.emailOutbox.findUnique({ where: { id: first.outboxId! } });
      assert.equal(firstAfter!.status, "EXPIRED", "the earlier reset row must be expired, never sent later");
      const secondRow = await db.emailOutbox.findUnique({ where: { id: second.outboxId! } });
      assert.equal(secondRow!.status, "PENDING", "the newest reset row is the one that stays live");
    });

    it("does not expire a same-recipient order-confirmation row when a new one is queued (not a superseding kind)", async () => {
      const to = `outbox-no-supersede-${randomUUID().slice(0, 8)}@example.com`;
      const first = await sendTransactionalEmail(
        { to, subject: "Order 1", html: "<p>1</p>" },
        EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER,
      );
      createdIds.push(first.outboxId!);
      const second = await sendTransactionalEmail(
        { to, subject: "Order 2", html: "<p>2</p>" },
        EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER,
      );
      createdIds.push(second.outboxId!);

      const firstAfter = await db.emailOutbox.findUnique({ where: { id: first.outboxId! } });
      assert.equal(firstAfter!.status, "PENDING", "order confirmations are never superseded by a later one");
    });

    it("drainEmailOutbox expires an overdue row instead of sending it, and never attempts it", async () => {
      const row = await db.emailOutbox.create({
        data: {
          to: `outbox-expired-${randomUUID().slice(0, 8)}@example.com`,
          subject: "Expired reset",
          html: "<p>test</p>",
          kind: EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
          status: "PENDING",
          expiresAt: new Date(Date.now() - 1000), // already overdue
        },
      });
      createdIds.push(row.id);

      let sendCalls = 0;
      const fakeSend = async (): Promise<SendEmailResult> => {
        sendCalls += 1;
        return { ok: true, provider: "brevo" };
      };

      const result = await drainEmailOutbox({ sendFn: fakeSend, ids: [row.id] });
      assert.equal(result.expired, 1);
      assert.equal(result.attempted, 0, "an expired row must never be claimed/attempted");
      assert.equal(sendCalls, 0);

      const updated = await db.emailOutbox.findUnique({ where: { id: row.id } });
      assert.equal(updated!.status, "EXPIRED");
    });

    it("drainEmailOutbox leaves a row with no expiresAt untouched (order confirmations stay eligible forever)", async () => {
      const row = await createPendingRow();
      const fakeSend = async (): Promise<SendEmailResult> => ({ ok: true, provider: "brevo" });

      const result = await drainEmailOutbox({ sendFn: fakeSend, ids: [row.id] });
      assert.equal(result.expired, 0);
      assert.equal(result.sent, 1);
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
