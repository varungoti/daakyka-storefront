import { test, expect, type Page } from "@playwright/test";

/**
 * release-hardening wave 4, storefront-perf-and-bundle-size (F-013, F-018,
 * F-256, F-260): the request-count side of the listing/product performance
 * fixes — what a shopper's browser asks the server for while using /shop, the
 * search dialog and a product page. Read-only, so it is safe against any
 * target. Counts are exact where the behaviour is exact (zero prefetches while
 * scrolling) and the assertions never depend on how many products the
 * catalogue holds.
 */

/** Same settle the other storefront specs use: lets hydration finish before
 * anything is measured. `networkidle` is not used — Next's prefetches of the
 * page's own links can keep it from ever settling on a second navigation in the
 * same page. */
async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForTimeout(1500);
}

/** A request for a product page that Next made as a prefetch/navigation (an
 * RSC request), not the document itself. */
function trackProductPrefetches(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    if (url.pathname.startsWith("/products/") && (headers["rsc"] === "1" || headers["next-router-prefetch"])) {
      paths.push(url.pathname);
    }
  });
  return paths;
}

test.describe("/shop does not prefetch every product page (F-260)", () => {
  test.use({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });

  test("scrolling the whole listing on a phone prefetches no product page", async ({ page }) => {
    const prefetched = trackProductPrefetches(page);
    await gotoAndSettle(page, "/shop");

    const loadMore = page.getByRole("button", { name: "Load more" });
    for (let round = 0; round < 3; round += 1) {
      for (let step = 0; step < 25; step += 1) {
        await page.evaluate(() => window.scrollBy(0, 700));
        await page.waitForTimeout(60);
      }
      if (await loadMore.count()) await loadMore.click();
    }
    await page.waitForTimeout(800);

    expect(prefetched, "product pages prefetched just by scrolling past them").toEqual([]);
  });
});

test.describe("product cards prefetch on intent (F-260)", () => {
  test("hovering a card prefetches its product page once, and the card still navigates", async ({ page }) => {
    const prefetched = trackProductPrefetches(page);
    await gotoAndSettle(page, "/shop");

    const card = page.locator("article").first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(prefetched).toEqual([]);

    const link = card.locator("a[data-card-link]");
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/products\//);

    await card.hover();
    await expect.poll(() => prefetched.length).toBe(1);
    expect(prefetched[0]).toBe(href);
    // Moving around the same card does not ask again.
    await card.hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);
    expect(prefetched).toHaveLength(1);

    await link.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("the search dialog downloads its product index once (F-013)", () => {
  test("three opens are one request, and the second open never shows Searching...", async ({ page }) => {
    let indexRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/products") indexRequests += 1;
    });
    await gotoAndSettle(page, "/about");
    expect(indexRequests, "loading a page alone must not download the index").toBe(0);

    const trigger = page.getByRole("button", { name: "Search", exact: true });
    const dialog = page.getByRole("dialog", { name: "Search products" });

    await trigger.click();
    await dialog.waitFor();
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await trigger.click();
    await dialog.waitFor();
    await expect(dialog.getByText("Searching...")).toHaveCount(0);
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await trigger.click();
    await dialog.waitFor();
    expect(indexRequests).toBe(1);
  });

  test("hovering the Search button starts the download before the dialog opens", async ({ page }) => {
    let indexRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/products") indexRequests += 1;
    });
    await gotoAndSettle(page, "/about");
    await page.getByRole("button", { name: "Search", exact: true }).hover();
    await expect.poll(() => indexRequests).toBe(1);
  });
});

test.describe("/shop applies the URL after it is prerendered (F-018)", () => {
  test("a ?category= deep link filters the grid, and a search from the dialog applies while already on /shop", async ({
    page,
  }) => {
    const count = async () =>
      (await page.getByRole("status").filter({ hasText: /Products?$/ }).first().innerText()).trim();

    await gotoAndSettle(page, "/shop");
    const all = await count();

    await gotoAndSettle(page, "/shop?category=for-hospitals");
    await expect.poll(count).not.toBe(all);

    // The query typed into the in-page box survives the URL round trip, spaces included.
    await gotoAndSettle(page, "/shop");
    const box = page.getByRole("searchbox", { name: "Search within results" });
    await box.click();
    await page.keyboard.type("scrub top", { delay: 40 });
    await page.waitForTimeout(1200);
    await expect(box).toHaveValue("scrub top");
    expect(page.url()).toContain("q=scrub");

    // Searching from the header dialog while already on /shop applies to the grid.
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const input = page.getByRole("combobox", { name: "Search products" });
    await input.fill("lab coat");
    await input.press("Enter");
    await page.waitForURL("**/shop?q=lab*");
    await expect(box).toHaveValue("lab coat");
  });

  test("Load more keeps what it revealed, and ?show= restores it", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    const loadMore = page.getByRole("button", { name: "Load more" });
    test.skip((await loadMore.count()) === 0, "the catalogue fits on one page");

    const first = await page.locator("article").count();
    await loadMore.click();
    await page.waitForTimeout(1500);
    const second = await page.locator("article").count();
    expect(second).toBeGreaterThan(first);

    await gotoAndSettle(page, "/shop?show=48");
    await expect.poll(() => page.locator("article").count()).toBeGreaterThan(first);
  });
});

/** Counts the product cards that are actually visible (not `visibility:hidden`,
 * not under a `display:none` ancestor), on every animation frame from the very
 * first one, and records each change: `window.__shopFrames` is the list of
 * distinct states the shopper's screen went through. Installed before the page's
 * own scripts, so nothing can be painted without being sampled. */
async function recordVisibleProductCards(page: Page) {
  await page.addInitScript(() => {
    const frames: { cards: number; pending: boolean }[] = [];
    (window as unknown as { __shopFrames: typeof frames }).__shopFrames = frames;
    const cards = () =>
      [...document.querySelectorAll("article")].filter(
        (card) => card.querySelector("a[data-card-link]") && card.checkVisibility({ visibilityProperty: true }),
      ).length;
    const tick = () => {
      const state = { cards: cards(), pending: Boolean(document.querySelector("[data-shop-url-pending]")) };
      const last = frames[frames.length - 1];
      if (!last || last.cards !== state.cards || last.pending !== state.pending) frames.push(state);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const shopFrames = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shopFrames: { cards: number; pending: boolean }[] }).__shopFrames);

/** Holds back the app's JavaScript chunks, so the page is hydrated well after
 * its HTML is on screen — the window in which a prerendered listing used to show
 * the wrong grid. Inline scripts (the streaming swap, the pending marker) are not
 * delayed, which is exactly the situation on a slow phone. */
async function delayHydration(page: Page, ms: number) {
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe("a filtered /shop link never paints the unfiltered grid (F-018)", () => {
  test.use({ viewport: { width: 412, height: 823 }, isMobile: true, hasTouch: true });

  test("?q= is applied before the grid is first shown, and nothing stays hidden afterwards", async ({
    page,
    request,
  }) => {
    const { products } = (await (await request.get("/api/products")).json()) as { products: { name: string }[] };
    test.skip(products.length < 2, "needs a catalogue with more than one product");

    await recordVisibleProductCards(page);
    await gotoAndSettle(page, "/shop");
    const unfiltered = (await shopFrames(page)).at(-1)!.cards;
    expect(unfiltered).toBeGreaterThan(0);

    const query = encodeURIComponent(products[0].name);
    await delayHydration(page, 2000);
    await page.goto(`/shop?q=${query}`, { waitUntil: "commit" });
    // Hydration arrives ~2 s after the HTML. The search box only holds the
    // query once the page has applied the URL, so this is "hydrated and
    // filtered" — and until then there should be nothing to see but the
    // skeleton, then exactly the filtered results.
    await expect(page.getByRole("searchbox", { name: "Search within results" })).toHaveValue(products[0].name, {
      timeout: 15_000,
    });
    await expect(page.locator("[data-shop-url-pending]")).toHaveCount(0);

    const frames = await shopFrames(page);
    const filtered = frames.at(-1)!.cards;
    test.skip(filtered === unfiltered, "the search matches the whole catalogue, so there is nothing to tell apart");

    expect(
      frames.filter((frame) => frame.cards > 0 && frame.cards !== filtered),
      "frames that showed the unfiltered grid before the filters were applied",
    ).toEqual([]);
    expect(
      frames.some((frame) => frame.pending),
      "the grid was marked pending while the page waited to be hydrated",
    ).toBe(true);
    expect(filtered).toBeLessThan(unfiltered);
  });

  test("a link with only tracking params shows the grid at once, not after hydration", async ({ page }) => {
    await recordVisibleProductCards(page);
    await delayHydration(page, 4000);
    await page.goto("/shop?utm_source=newsletter&gclid=abc", { waitUntil: "commit" });

    // Visible long before the (4 s late) scripts: it must not wait for them.
    await expect.poll(async () => (await shopFrames(page)).at(-1)?.cards ?? 0, { timeout: 3500 }).toBeGreaterThan(0);
    expect((await shopFrames(page)).some((frame) => frame.pending)).toBe(false);
  });
});

test.describe("the product page asks who is signed in only from the browser (F-256)", () => {
  test("a guest gets the Write a Review link once the reviews are near, from one request", async ({ page, request }) => {
    const { products } = (await (await request.get("/api/products")).json()) as { products: { handle: string }[] };
    test.skip(products.length === 0, "no products seeded to test against");

    const eligibilityRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/review-eligibility")) eligibilityRequests.push(req.url());
    });
    await gotoAndSettle(page, `/products/${products[0].handle}`);
    expect(eligibilityRequests, "not asked until the reviews section is near").toEqual([]);

    await page.locator("#reviews").scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Write a Review" })).toBeVisible();
    expect(eligibilityRequests).toHaveLength(1);

    const answer = await request.get(`/api/products/${products[0].handle}/review-eligibility`);
    expect(answer.status()).toBe(200);
    expect(await answer.json()).toEqual({ status: "guest" });
    expect(answer.headers()["cache-control"]).toContain("no-store");
  });

  test("an unknown product gets a 404 from the eligibility endpoint", async ({ request }) => {
    const answer = await request.get("/api/products/no-such-product-handle/review-eligibility");
    expect(answer.status()).toBe(404);
  });
});
