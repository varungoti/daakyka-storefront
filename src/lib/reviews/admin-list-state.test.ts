import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendReviewsPage,
  dedupeReviewsById,
  pendingSelection,
  removeReviews,
  reviewActionConfirmMessage,
  reviewRowActions,
  reviewsQueryString,
  setReviewStatuses,
  statusAfter,
  viewNeedsRefill,
} from "@/lib/reviews/admin-list-state";
import type { AdminReviewRow, ListReviewsForAdminResult } from "@/lib/reviews/moderate-review";

// F-203: the review moderation page's list-state and action rules. The page
// itself is a client component with no test harness for it in this repo, so
// the logic that decides what the moderator sees after a page load, an
// Approve/Unpublish/Restore or a bulk action lives in plain functions and is
// pinned here.

function review(id: string, status: AdminReviewRow["status"], overrides: Partial<AdminReviewRow> = {}): AdminReviewRow {
  return {
    id,
    rating: 5,
    title: null,
    body: "Great scrubs",
    status,
    verifiedPurchase: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    moderatedAt: null,
    photos: [],
    customer: { id: "c1", name: "Priya", email: "priya@example.com" },
    product: { id: "p1", name: "Scrub top", slug: "scrub-top", image: null },
    ...overrides,
  };
}

function list(reviews: AdminReviewRow[], extra: Partial<ListReviewsForAdminResult> = {}): ListReviewsForAdminResult {
  return { reviews, total: reviews.length, page: 1, pageSize: 20, hasMore: false, ...extra };
}

describe("reviewsQueryString", () => {
  it("sends nothing for the All tab's first page, so the common request URL is unchanged", () => {
    assert.equal(reviewsQueryString("ALL", 1), "");
  });

  it("sends the status for a filtered tab, and the page only past page 1", () => {
    assert.equal(reviewsQueryString("PENDING", 1), "?status=PENDING");
    assert.equal(reviewsQueryString("PENDING", 2), "?status=PENDING&page=2");
    assert.equal(reviewsQueryString("ALL", 3), "?page=3");
  });
});

describe("Load more (page / hasMore)", () => {
  it("appends the next page after the rows already shown and takes paging state from the newest page", () => {
    const first = list([review("a", "PENDING"), review("b", "PENDING")], { total: 5, page: 1, hasMore: true });
    const second = list([review("c", "PENDING"), review("d", "PENDING")], { total: 5, page: 2, hasMore: true });
    const merged = appendReviewsPage(first, second);
    assert.deepEqual(merged.reviews.map((r) => r.id), ["a", "b", "c", "d"]);
    assert.equal(merged.page, 2);
    assert.equal(merged.hasMore, true);
    assert.equal(merged.total, 5);
  });

  it("drops a row the next page repeats (the server-side offset moved after an action), keeping the loaded copy", () => {
    const first = list([review("a", "PENDING", { body: "loaded copy" }), review("b", "PENDING")], { total: 3, hasMore: true });
    const second = list([review("b", "PENDING"), review("c", "PENDING")], { total: 3, page: 2, hasMore: false });
    const merged = appendReviewsPage(first, second);
    assert.deepEqual(merged.reviews.map((r) => r.id), ["a", "b", "c"]);
    assert.equal(merged.reviews[0].body, "loaded copy");
    assert.equal(merged.hasMore, false);
  });

  it("dedupeReviewsById keeps the first occurrence, in order", () => {
    assert.deepEqual(
      dedupeReviewsById([review("a", "PENDING"), review("b", "PENDING"), review("a", "APPROVED")]).map((r) => [r.id, r.status]),
      [
        ["a", "PENDING"],
        ["b", "PENDING"],
      ],
    );
  });
});

describe("list after a moderation", () => {
  it("removeReviews drops the handled rows from a filtered tab and decrements the real total", () => {
    const before = list([review("a", "PENDING"), review("b", "PENDING"), review("c", "PENDING")], { total: 45, hasMore: true });
    const after = removeReviews(before, ["a", "c"]);
    assert.deepEqual(after.reviews.map((r) => r.id), ["b"]);
    assert.equal(after.total, 43);
    assert.equal(after.hasMore, true, "paging state is untouched");
  });

  it("removeReviews never takes the total below zero", () => {
    assert.equal(removeReviews(list([review("a", "PENDING")], { total: 1 }), ["a", "ghost"]).total, 0);
  });

  it("setReviewStatuses changes status in place for the All tab and touches nothing else", () => {
    const before = list([review("a", "PENDING"), review("b", "APPROVED"), review("c", "PENDING")]);
    const after = setReviewStatuses(before, ["a", "b"], "REJECTED");
    assert.deepEqual(after.reviews.map((r) => r.status), ["REJECTED", "REJECTED", "PENDING"]);
    assert.equal(after.total, before.total);
    assert.equal(before.reviews[0].status, "PENDING", "the input list is not mutated");
  });

  it("statusAfter maps Approve to APPROVED and Reject (Unpublish) to REJECTED", () => {
    assert.equal(statusAfter("approve"), "APPROVED");
    assert.equal(statusAfter("reject"), "REJECTED");
  });
});

describe("viewNeedsRefill — the queue must not read 'No reviews in this view' while more remain", () => {
  it("is true when the last visible row is handled and the filter still has more behind it", () => {
    // 20 loaded of 45 pending, approve all 20 -> 25 still pending, nothing on screen.
    assert.equal(viewNeedsRefill(20, 45, 20), true);
    assert.equal(viewNeedsRefill(1, 2, 1), true);
  });

  it("is false while rows remain on screen", () => {
    assert.equal(viewNeedsRefill(20, 45, 5), false);
  });

  it("is false when that really was the last review of the filter", () => {
    assert.equal(viewNeedsRefill(1, 1, 1), false);
    assert.equal(viewNeedsRefill(20, 20, 20), false);
  });
});

describe("pendingSelection (select all pending)", () => {
  const rows = [review("a", "PENDING"), review("b", "APPROVED"), review("c", "PENDING"), review("d", "REJECTED")];

  it("covers only the pending rows shown", () => {
    assert.deepEqual(pendingSelection(rows, new Set()).pendingIds, ["a", "c"]);
  });

  it("is 'all selected' only once every pending row is", () => {
    assert.equal(pendingSelection(rows, new Set()).allSelected, false);
    assert.equal(pendingSelection(rows, new Set(["a"])).allSelected, false);
    assert.equal(pendingSelection(rows, new Set(["a", "c"])).allSelected, true);
  });

  it("is never 'all selected' when nothing pending is shown, even for a stale selection", () => {
    const approvedOnly = [review("b", "APPROVED")];
    assert.deepEqual(pendingSelection(approvedOnly, new Set(["b"])), { pendingIds: [], allSelected: false });
  });
});

describe("row actions — every status can be moderated (Unpublish / Restore)", () => {
  it("PENDING gets Approve and Reject", () => {
    assert.deepEqual(
      reviewRowActions("PENDING").map((a) => [a.action, a.label]),
      [
        ["approve", "Approve"],
        ["reject", "Reject"],
      ],
    );
  });

  it("an APPROVED review can be taken down: Unpublish, which is a reject", () => {
    assert.deepEqual(
      reviewRowActions("APPROVED").map((a) => [a.action, a.label]),
      [["reject", "Unpublish"]],
    );
  });

  it("a REJECTED review can be restored: Restore, which is an approve", () => {
    assert.deepEqual(
      reviewRowActions("REJECTED").map((a) => [a.action, a.label]),
      [["approve", "Restore"]],
    );
  });
});

describe("reviewActionConfirmMessage", () => {
  it("everyday queue work (approve or reject a pending review) never asks", () => {
    assert.equal(reviewActionConfirmMessage("PENDING", "approve", 2), null);
    assert.equal(reviewActionConfirmMessage("PENDING", "reject", 2), null);
  });

  it("unpublishing a live review asks, and warns that its photos are deleted only when it has photos", () => {
    assert.equal(reviewActionConfirmMessage("APPROVED", "reject", 0), "Unpublish this review from the product page?");
    assert.match(reviewActionConfirmMessage("APPROVED", "reject", 1) ?? "", /photos will be permanently deleted/);
  });

  it("restoring a rejected review asks, and says the photos are gone", () => {
    assert.match(reviewActionConfirmMessage("REJECTED", "approve", 0) ?? "", /photos it had were deleted/);
  });
});
