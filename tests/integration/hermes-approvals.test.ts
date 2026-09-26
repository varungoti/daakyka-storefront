import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { PATCH as patchApproval } from "@/app/api/admin/hermes/approvals/[id]/route";
import { GET as cronHermesGet, POST as cronHermesPost, isWeeklyScanDue } from "@/app/api/cron/hermes/route";
import { findAnyAdminId } from "../helpers/admin-user";
import { withEnv } from "../helpers/env";

/**
 * Phase G: Hermes approvals idempotency + output preview.
 *
 * Route handlers can't be called with a real authenticated session outside
 * an actual Next.js request (see tests/integration/orders-admin.test.ts for
 * the same constraint/rationale), so the approve/reject business rule is
 * tested directly against reviewHermesApproval, the service function the
 * route calls. Only the 401/403 no-session path is tested through the route.
 */

const createdApprovalIds: string[] = [];
const createdCampaignNames: string[] = [];

function baseApproval(overrides: Partial<Parameters<typeof db.hermesApproval.create>[0]["data"]> = {}) {
  return {
    type: "campaign_draft",
    title: `Campaign: Idempotency Test ${Math.random().toString(36).slice(2, 10)}`,
    summary: "Test campaign draft from Hermes.",
    payload: JSON.stringify({ channel: "EMAIL" }),
    status: "PENDING" as const,
    ...overrides,
  };
}

after(async () => {
  if (createdApprovalIds.length > 0) {
    await db.hermesApproval.deleteMany({ where: { id: { in: createdApprovalIds } } }).catch(() => {});
  }
  if (createdCampaignNames.length > 0) {
    await db.campaign.deleteMany({ where: { name: { in: createdCampaignNames } } }).catch(() => {});
  }
});

describe("reviewHermesApproval idempotency (Phase G)", () => {
  it("only creates one Campaign when the same approval is approved twice", async () => {
    const adminId = await findAnyAdminId();
    const data = baseApproval();
    createdCampaignNames.push(data.title.replace(/^Campaign:\s*/i, ""));

    const approval = await db.hermesApproval.create({ data });
    createdApprovalIds.push(approval.id);

    const first = await reviewHermesApproval(approval.id, "APPROVED", adminId);
    assert.ok(first);
    assert.equal(first.transitioned, true);
    assert.equal(first.execution?.action, "campaign_draft_created");
    assert.ok(first.execution?.entityId);

    const second = await reviewHermesApproval(approval.id, "APPROVED", adminId);
    assert.ok(second);
    assert.equal(second.transitioned, false, "a second review of the same approval must be a no-op");
    assert.equal(second.execution?.entityId, first.execution?.entityId);

    const campaigns = await db.campaign.findMany({
      where: { name: data.title.replace(/^Campaign:\s*/i, "") },
    });
    assert.equal(campaigns.length, 1, "expected exactly one Campaign row after two approvals of the same id");
  });

  it("persists the execution result on the approval row", async () => {
    const adminId = await findAnyAdminId();
    const data = baseApproval();
    createdCampaignNames.push(data.title.replace(/^Campaign:\s*/i, ""));

    const approval = await db.hermesApproval.create({ data });
    createdApprovalIds.push(approval.id);

    await reviewHermesApproval(approval.id, "APPROVED", adminId);

    const stored = await db.hermesApproval.findUniqueOrThrow({ where: { id: approval.id } });
    const result = stored.executionResult as { ok: boolean; action?: string } | null;
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.action, "campaign_draft_created");
  });

  it("does not execute side effects for a rejected approval", async () => {
    const adminId = await findAnyAdminId();
    const data = baseApproval();
    createdCampaignNames.push(data.title.replace(/^Campaign:\s*/i, ""));

    const approval = await db.hermesApproval.create({ data });
    createdApprovalIds.push(approval.id);

    const result = await reviewHermesApproval(approval.id, "REJECTED", adminId);
    assert.ok(result);
    assert.equal(result.transitioned, true);
    assert.equal(result.execution, null);

    const campaigns = await db.campaign.findMany({
      where: { name: data.title.replace(/^Campaign:\s*/i, "") },
    });
    assert.equal(campaigns.length, 0);
  });

  it("returns null for an approval id that does not exist", async () => {
    const adminId = await findAnyAdminId();
    const result = await reviewHermesApproval("does-not-exist", "APPROVED", adminId);
    assert.equal(result, null);
  });
});

describe("PATCH /api/admin/hermes/approvals/[id] without a session", () => {
  it("rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/hermes/approvals/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    const response = await patchApproval(request, { params: Promise.resolve({ id: "any-id" }) });
    assert.ok(response.status === 401 || response.status === 403);
  });
});

describe("isWeeklyScanDue (F-276)", () => {
  it("is true only on Monday (UTC), so weekly_competitor_scan doesn't run every day", () => {
    assert.equal(isWeeklyScanDue(new Date("2026-09-28T06:00:00.000Z")), true, "Monday");
    assert.equal(isWeeklyScanDue(new Date("2026-09-27T06:00:00.000Z")), false, "Sunday");
    assert.equal(isWeeklyScanDue(new Date("2026-09-29T06:00:00.000Z")), false, "Tuesday");
  });
});

describe("GET/POST /api/cron/hermes stub placeholders (F-276)", () => {
  const TEST_CRON_SECRET = "hermes-cron-test-secret";
  const createdTaskIds: string[] = [];
  const createdApprovalIds: string[] = [];

  beforeEach(async () => {
    await db.cronRun.deleteMany({ where: { job: "hermes" } });
  });

  after(async () => {
    await db.cronRun.deleteMany({ where: { job: "hermes" } });
    if (createdApprovalIds.length) {
      await db.hermesApproval.deleteMany({ where: { id: { in: createdApprovalIds } } }).catch(() => {});
    }
    if (createdTaskIds.length) {
      await db.hermesTask.deleteMany({ where: { id: { in: createdTaskIds } } }).catch(() => {});
    }
    await db.integrationSetting.deleteMany({ where: { provider: "HERMES" } });
  });

  it("401s without the bearer secret (GET and POST)", async () => {
    await withEnv({ CRON_SECRET: TEST_CRON_SECRET }, async () => {
      assert.equal((await cronHermesPost(new Request("http://localhost/api/cron/hermes"))).status, 401);
      assert.equal((await cronHermesGet(new Request("http://localhost/api/cron/hermes"))).status, 401);
    });
  });

  it("records the HermesTask but does not queue a PENDING approval when Hermes returns a stub result", async () => {
    // Inline runtime, opted in, but no FIREWORKS_API_KEY — the exact "not
    // really configured" combination F-276 found silently piling up
    // generic "Scheduled: …" approvals every day.
    await db.integrationSetting.upsert({
      where: { provider: "HERMES" },
      update: { enabled: true },
      create: { provider: "HERMES", enabled: true, config: "{}" },
    });

    await withEnv(
      {
        CRON_SECRET: TEST_CRON_SECRET,
        HERMES_RUNTIME_INLINE: "1",
        HERMES_LOCAL_URL: undefined,
        HERMES_API_URL: undefined,
        FIREWORKS_API_KEY: undefined,
      },
      async () => {
        const request = new Request("http://localhost/api/cron/hermes", {
          headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
        });
        const response = await cronHermesPost(request);
        assert.equal(response.status, 200);
        const body = (await response.json()) as { ok: boolean; results: { type: string; ok: boolean; stub: boolean }[] };
        assert.equal(body.ok, true);

        const dailyResult = body.results.find((r) => r.type === "daily_seo_health_scan");
        assert.ok(dailyResult, "expected the daily task to run regardless of the day");
        assert.equal(dailyResult!.ok, true);
        assert.equal(dailyResult!.stub, true, "Fireworks-not-configured must surface as a stub result");

        const task = await db.hermesTask.findFirst({
          where: { type: "daily_seo_health_scan" },
          orderBy: { createdAt: "desc" },
        });
        assert.ok(task, "the task itself is still recorded");
        createdTaskIds.push(task!.id);
        assert.equal(task!.status, "COMPLETED");

        const approval = await db.hermesApproval.findFirst({ where: { taskId: task!.id } });
        if (approval) createdApprovalIds.push(approval.id);
        assert.equal(approval, null, "a stub result must not create a PENDING approval placeholder");
      },
    );
  });
});
