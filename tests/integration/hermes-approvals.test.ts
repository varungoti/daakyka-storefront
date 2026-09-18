import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { PATCH as patchApproval } from "@/app/api/admin/hermes/approvals/[id]/route";

/**
 * Phase G: Hermes approvals idempotency + output preview.
 *
 * Route handlers can't be called with a real authenticated session outside
 * an actual Next.js request (see tests/integration/orders-admin.test.ts for
 * the same constraint/rationale), so the approve/reject business rule is
 * tested directly against reviewHermesApproval, the service function the
 * route calls. Only the 401/403 no-session path is tested through the route.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

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
