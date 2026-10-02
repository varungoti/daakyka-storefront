import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { canApproveHermesApproval } from "@/lib/hermes/approval-permissions";
import { blogPostSchema } from "@/lib/validation/schemas";
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
const createdBlogSlugs: string[] = [];

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
  if (createdBlogSlugs.length > 0) {
    await db.blogPostRecord.deleteMany({ where: { slug: { in: createdBlogSlugs } } }).catch(() => {});
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

// F-213: approving a blog_draft stored a plain string in BlogPostRecord.content
// (every reader expects a JSON array of paragraphs) under a title-derived slug
// that kept punctuation ("hermes:-blog-draft"). Opening the draft in the CMS
// then crashed the admin error boundary.
describe("Hermes blog_draft approval produces a post the CMS can open (F-213)", () => {
  async function approveBlogDraft(titleSuffix: string, payload: Record<string, unknown>) {
    const adminId = await findAnyAdminId();
    const approval = await db.hermesApproval.create({
      data: {
        type: "blog_draft",
        title: `Hermes: blog draft ${titleSuffix}`,
        summary: "Draft ready for review: how to care for hospital linens.",
        payload: JSON.stringify(payload),
        status: "PENDING",
      },
    });
    createdApprovalIds.push(approval.id);
    const result = await reviewHermesApproval(approval.id, "APPROVED", adminId);
    assert.ok(result);
    assert.equal(result.execution?.action, "blog_draft_created");
    const post = await db.blogPostRecord.findUniqueOrThrow({ where: { id: result.execution!.entityId } });
    createdBlogSlugs.push(post.slug);
    return { post, approval, adminId };
  }

  it("stores the body as a JSON array of paragraphs, even with no draftContent in the payload", async () => {
    const { post } = await approveBlogDraft(`no-body ${Date.now()}`, {});
    const parsed: unknown = JSON.parse(post.content);
    assert.ok(Array.isArray(parsed) && parsed.length >= 1 && parsed.every((p) => typeof p === "string"));
  });

  it("splits a plain-text draftContent into paragraphs on blank lines", async () => {
    const { post } = await approveBlogDraft(`text-body ${Date.now()}`, {
      draftContent: "First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.",
    });
    assert.deepEqual(JSON.parse(post.content), ["First paragraph.", "Second paragraph.", "Third paragraph."]);
  });

  it("keeps an array draftContent as-is", async () => {
    const { post } = await approveBlogDraft(`array-body ${Date.now()}`, { draftContent: ["One.", "Two."] });
    assert.deepEqual(JSON.parse(post.content), ["One.", "Two."]);
  });

  it("derives a slug the blog schema accepts (no colon or spaces), and the draft passes blogPostSchema as saved", async () => {
    const { post } = await approveBlogDraft(`Slug Check ${Date.now()}`, {});
    assert.match(post.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!post.slug.startsWith("hermes"), "the 'Hermes:' title prefix is not part of the slug");

    const resaved = blogPostSchema.safeParse({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      author: post.author,
      publishedAt: post.publishedAt.toISOString().slice(0, 10),
      readTime: post.readTime,
      image: post.image,
      content: JSON.parse(post.content),
      status: post.status,
    });
    assert.equal(
      resaved.success,
      true,
      "the owner must be able to open the draft in the editor and save it without fixing the slug or image first",
    );
  });

  it("normalises an unsafe payload slug the same way", async () => {
    const { post } = await approveBlogDraft(`payload-slug ${Date.now()}`, { slug: "Hermes: How To Care?? " });
    assert.equal(post.slug, "hermes-how-to-care");
  });

  // F-293: the approval route's own audit row says an approval happened, but
  // nothing recorded which blog post / campaign it created.
  it("audit-logs the blog post it creates, attributed to the approver", async () => {
    const { post, approval, adminId } = await approveBlogDraft(`audit ${Date.now()}`, {});
    const row = await db.auditLog.findFirst({ where: { entity: "blog_post", entityId: post.id, action: "create" } });
    assert.ok(row, "expected a create audit row for the Hermes-created blog post");
    assert.equal(row.userId, adminId);
    assert.deepEqual(JSON.parse(row.metadata ?? "{}"), { source: "hermes", approvalId: approval.id });
  });
});

describe("Hermes campaign_draft approval is audit-logged (F-293)", () => {
  it("records a create audit row for the campaign, attributed to the approver", async () => {
    const adminId = await findAnyAdminId();
    const data = baseApproval();
    createdCampaignNames.push(data.title.replace(/^Campaign:\s*/i, ""));
    const approval = await db.hermesApproval.create({ data });
    createdApprovalIds.push(approval.id);

    const result = await reviewHermesApproval(approval.id, "APPROVED", adminId);
    assert.equal(result?.execution?.action, "campaign_draft_created");

    const row = await db.auditLog.findFirst({
      where: { entity: "campaign", entityId: result!.execution!.entityId, action: "create" },
    });
    assert.ok(row, "expected a create audit row for the Hermes-created campaign");
    assert.equal(row.userId, adminId);
    assert.deepEqual(JSON.parse(row.metadata ?? "{}"), { source: "hermes", approvalId: approval.id });
  });
});

// F-293: PATCH only checked hermes:manage, which SEO_MANAGER has without
// engagement:manage — so it could approve a campaign draft into existence
// that it then couldn't even open. Approving needs the permission of the
// entity it creates. (The route itself can't be driven with a session here —
// see the note at the top of this file — so the decision it makes is tested.)
describe("canApproveHermesApproval (F-293)", () => {
  it("requires campaign permissions to approve a campaign_draft", () => {
    assert.equal(canApproveHermesApproval("SEO_MANAGER", "campaign_draft"), false);
    assert.equal(canApproveHermesApproval("CONTENT_EDITOR", "campaign_draft"), false);
    assert.equal(canApproveHermesApproval("MARKETING_ADMIN", "campaign_draft"), true);
    assert.equal(canApproveHermesApproval("SUPER_ADMIN", "campaign_draft"), true);
  });

  it("requires blog permissions to approve a blog_draft", () => {
    assert.equal(canApproveHermesApproval("SEO_MANAGER", "blog_draft"), true);
    assert.equal(canApproveHermesApproval("MARKETING_ADMIN", "blog_draft"), true);
    assert.equal(canApproveHermesApproval("VIEWER", "blog_draft"), false);
  });

  it("needs nothing beyond hermes:manage for notification-only item types", () => {
    assert.equal(canApproveHermesApproval("SEO_MANAGER", "daily_seo_health_scan"), true);
    assert.equal(canApproveHermesApproval("SEO_MANAGER", "something_unknown"), true);
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
