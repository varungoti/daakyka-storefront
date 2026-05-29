import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WeeklyGrowthReport } from "@/lib/reports/weekly-growth";
import { formatWeeklyGrowthReportMarkdown } from "@/lib/reports/weekly-growth";

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
