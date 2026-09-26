import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import type { WeeklyGrowthReport } from "@/lib/reports/weekly-growth";
import { formatWeeklyGrowthReportMarkdown, getCommerceStats } from "@/lib/reports/weekly-growth";

// F-058: buildWeeklyGrowthReport used to read the legacy Shopify-webhook
// OrderEvent table (never written by native checkout), so Orders/Revenue
// always showed 0 / ₹0. getCommerceStats now reads the native Order table
// instead. It's split out specifically so this can be tested by stubbing
// just db.order.aggregate, rather than every query buildWeeklyGrowthReport's
// Promise.all makes.
describe("getCommerceStats", () => {
  it("counts orders and sums revenue from db.order.aggregate, converting the Decimal total", async () => {
    const original = db.order.aggregate;
    let capturedArgs: Parameters<typeof db.order.aggregate>[0] | undefined;
    // @ts-expect-error - stubbing a Prisma delegate method for the test only.
    db.order.aggregate = async (args) => {
      capturedArgs = args;
      return { _count: { _all: 27 }, _sum: { total: 18660.51 } };
    };

    try {
      const since = new Date("2026-09-01T00:00:00.000Z");
      const stats = await getCommerceStats(since);

      assert.equal(stats.orders, 27);
      assert.equal(stats.revenueInr, 18660.51);
      assert.deepEqual(capturedArgs?.where?.createdAt, { gte: since });
      const statusFilter = capturedArgs?.where?.status as { in?: string[] } | undefined;
      assert.deepEqual(
        [...(statusFilter?.in ?? [])].sort(),
        ["DELIVERED", "PAID", "PROCESSING", "SHIPPED"],
        "must exclude PENDING_PAYMENT, CANCELLED and REFUNDED",
      );
    } finally {
      db.order.aggregate = original;
    }
  });

  it("returns zero orders and zero revenue when nothing matches (no NaN from a null Decimal sum)", async () => {
    const original = db.order.aggregate;
    // @ts-expect-error - stubbing a Prisma delegate method for the test only.
    db.order.aggregate = async () => ({ _count: { _all: 0 }, _sum: { total: null } });

    try {
      const stats = await getCommerceStats(new Date());
      assert.equal(stats.orders, 0);
      assert.equal(stats.revenueInr, 0);
    } finally {
      db.order.aggregate = original;
    }
  });
});

describe("weekly growth report", () => {
  it("formats markdown summary with recommendations", () => {
    const report: WeeklyGrowthReport = {
      periodDays: 7,
      generatedAt: "2026-05-29T10:00:00.000Z",
      commerce: { orders: 3, revenueInr: 12000, cartAbandonments: 5, productViews: 42 },
      leads: { bulkOrders: 2, contactEnquiries: 1, newsletterSignups: 8 },
      engagement: {
        activeJourneyEnrollments: 4,
        journeyEvents: 10,
        pendingCampaigns: 1,
        sentCampaigns: 2,
        pendingHermesApprovals: 1,
      },
      content: {
        publishedBlogPosts: 3,
        seoPagesHealthy: 20,
        seoPagesNeedingWork: 2,
        topProductInsights: 15,
      },
      topViewedProducts: [{ handle: "classic-top", name: "Classic Top", views: 12 }],
      recommendations: ["Approve pending campaign."],
    };

    const markdown = formatWeeklyGrowthReportMarkdown(report);
    assert.match(markdown, /Weekly Growth Report/);
    assert.match(markdown, /Orders: 3/);
    assert.match(markdown, /Approve pending campaign/);
    assert.match(markdown, /Classic Top/);
  });
});
