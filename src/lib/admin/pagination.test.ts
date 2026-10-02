import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminListHref, firstParam, getPageWindow, parsePageParam } from "@/lib/admin/pagination";

// F-168 (and F-167/F-201, which share these helpers): the notifications page
// was a single `take: 30` over a 2,206-row table, with the stat card
// reporting that cap as the total. These pin the paging math the rebuilt
// page uses — the real total in, the right skip/take window out.

describe("parsePageParam", () => {
  it("reads a plain page number", () => {
    assert.equal(parsePageParam("3"), 3);
  });

  it("falls back to page 1 for anything that isn't a positive whole number", () => {
    for (const raw of [undefined, "", "0", "-4", "abc", "2.5", "1e9999", "999999999"]) {
      assert.equal(parsePageParam(raw), 1, `parsePageParam(${JSON.stringify(raw)})`);
    }
  });

  it("takes the first value of a repeated ?page=2&page=3", () => {
    assert.equal(parsePageParam(["2", "3"]), 2);
    assert.equal(firstParam(["a", "b"]), "a");
    assert.equal(firstParam(undefined), undefined);
  });
});

describe("getPageWindow (notifications paging, F-168)", () => {
  it("the first page of 2,206 notifications is 25 rows from offset 0, out of 89 pages", () => {
    const window = getPageWindow(1, 2206, 25);
    assert.deepEqual(window, { page: 1, pageSize: 25, total: 2206, totalPages: 89, skip: 0, take: 25 });
  });

  it("page 3 skips the first two pages", () => {
    const window = getPageWindow(3, 2206, 25);
    assert.equal(window.page, 3);
    assert.equal(window.skip, 50);
    assert.equal(window.take, 25);
  });

  it("the last page starts at the final partial page's offset", () => {
    const window = getPageWindow(89, 2206, 25);
    assert.equal(window.page, 89);
    assert.equal(window.skip, 2200);
  });

  it("a stale page number past the end clamps to the last page instead of an empty list", () => {
    const window = getPageWindow(9999, 2206, 25);
    assert.equal(window.page, 89);
    assert.equal(window.skip, 2200);
  });

  it("an empty table is one page with nothing to skip", () => {
    const window = getPageWindow(1, 0, 25);
    assert.equal(window.totalPages, 1);
    assert.equal(window.page, 1);
    assert.equal(window.skip, 0);
  });

  it("an exact multiple of the page size has no trailing empty page", () => {
    assert.equal(getPageWindow(1, 50, 25).totalPages, 2);
    assert.equal(getPageWindow(1, 51, 25).totalPages, 3);
  });

  it("the unread-only view pages over the unread count, not the whole table", () => {
    // 45 unread of 2,223 total (the audit's numbers): two pages, not 89.
    const window = getPageWindow(1, 45, 25);
    assert.equal(window.totalPages, 2);
    assert.equal(window.total, 45);
  });
});

describe("adminListHref", () => {
  it("omits page 1 and empty params so the first page keeps a clean URL", () => {
    assert.equal(adminListHref("/admin/notifications", { page: 1 }), "/admin/notifications");
    assert.equal(adminListHref("/admin/notifications", { filter: undefined, page: 1 }), "/admin/notifications");
    assert.equal(adminListHref("/admin/notifications", { filter: "", page: undefined }), "/admin/notifications");
  });

  it("keeps the filter across pages", () => {
    assert.equal(
      adminListHref("/admin/notifications", { filter: "unread", page: 2 }),
      "/admin/notifications?filter=unread&page=2",
    );
  });

  it("encodes values", () => {
    assert.equal(adminListHref("/admin/audit-logs", { action: "a b&c" }), "/admin/audit-logs?action=a+b%26c");
  });
});
