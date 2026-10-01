import { test, expect, type Locator, type Page } from "@playwright/test";
import { CONDENSED_RATING_HTML } from "./helpers/rated-card-fixture";

/**
 * Release-hardening audit "storefront-mobile-polish" (F-009, F-011, F-021,
 * F-085, F-100, F-240, F-242): phone-width regression net for the storefront.
 * Every test here runs in a touch-enabled phone viewport, because these
 * defects only exist below the `sm`/`md`/`lg` breakpoints — the desktop
 * suites (storefront.spec.ts, accessibility.spec.ts) never see them.
 *
 * Numbers are deliberately loose bounds with a wide margin (not pixel
 * snapshots) so a copy or catalogue change can't flake them: the original
 * defects were 1,438px-tall heroes, 45,000px-tall listings and 7px of
 * sideways scroll, not 10px layout drift.
 */

const SMALL_PHONES = [
  { width: 320, height: 640 },
  { width: 360, height: 640 },
  { width: 375, height: 812 },
];

const PHONE = { width: 375, height: 812 };

/** Same settle the accessibility spec uses: lets hydration and the entrance
 * animations finish before anything is measured. */
async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForTimeout(1000);
}

/** The listing grid is the parent of the first product card. */
async function gridInfo(page: Page) {
  return page.evaluate(() => {
    const first = document.querySelector("article");
    const grid = first?.parentElement;
    if (!first || !grid) return null;
    return {
      cards: grid.children.length,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      firstCardTop: first.getBoundingClientRect().top + window.scrollY,
    };
  });
}

test.describe("Mobile layout: no horizontal scroll (F-011)", () => {
  for (const { width, height } of SMALL_PHONES) {
    test.describe(`${width}x${height}`, () => {
      test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

      for (const path of ["/", "/shop", "/category/scrub-sets", "/about"]) {
        test(`${path} fits the viewport and keeps the menu button on screen`, async ({ page }) => {
          await gotoAndSettle(page, path);

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);

          const menu = await page.getByRole("button", { name: "Open menu" }).boundingBox();
          expect(menu, "menu button is rendered").not.toBeNull();
          expect(menu!.x + menu!.width, "menu button is cut off at the right edge").toBeLessThanOrEqual(width);
        });
      }
    });
  }
});

test.describe("Mobile home (F-085)", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("announcement bar is compact and the hero shows its image and CTA on the first screen", async ({ page }) => {
    await gotoAndSettle(page, "/");

    // The utility bar sits above the header, so the header's top edge is its
    // height: three stacked lines plus a wrapped button used to make it ~110px.
    const header = await page.getByRole("banner").boundingBox();
    expect(header!.y, "announcement bar height").toBeLessThan(64);

    const hero = page.getByRole("region", { name: "Featured collections" });
    const heroBox = await hero.boundingBox();
    expect(heroBox!.height, "mobile hero height (was 1,438px)").toBeLessThan(1050);

    const image = await hero.locator(".animate-scale-in img").first().boundingBox();
    expect(image!.y, "first hero image starts below the fold").toBeLessThan(PHONE.height);

    const firstCta = await hero.locator("a").first().boundingBox();
    expect(firstCta!.y + firstCta!.height, "first slide's primary CTA is below the fold").toBeLessThanOrEqual(
      PHONE.height,
    );
  });
});

test.describe("Mobile header menu (F-009)", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("the menu offers the currency switcher and the wishlist, which opens its drawer", async ({ page }) => {
    await gotoAndSettle(page, "/");
    await page.getByRole("button", { name: "Open menu" }).first().click();

    const nav = page.getByRole("dialog", { name: "Site navigation" });
    await expect(nav.getByRole("group", { name: "Select currency" })).toBeVisible();

    await nav.getByRole("button", { name: /^Wishlist/ }).click();
    await expect(page.getByRole("dialog", { name: "Wishlist" })).toBeVisible();
    await expect(nav).toBeHidden();
  });
});

test.describe("Mobile listings (F-021, F-100, F-242)", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("/shop is a 2-column grid with a product on the first screen and a paginated list", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });

    const info = await gridInfo(page);
    expect(info, "listing grid").not.toBeNull();
    expect(info!.columns, "phone grid columns").toBe(2);
    expect(info!.cards, "cards rendered before Load more").toBeLessThanOrEqual(24);
    expect(info!.firstCardTop, "first product starts below the first screen").toBeLessThan(PHONE.height);
  });

  test("tapping a product photo opens the product page, not a lightbox", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });

    await page.locator("article").first().locator("a").first().click();
    await page.waitForURL(/\/products\//);
    await expect(page.getByRole("dialog", { name: "Image viewer" })).toHaveCount(0);
  });

  test("Load more keeps its place in the URL, so Back from a product restores the list", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    const loadMore = page.getByRole("button", { name: "Load more", exact: true });
    test.skip((await loadMore.count()) === 0, "needs more than one page of products in the catalogue");

    const before = (await gridInfo(page))!.cards;
    await loadMore.click();
    await expect.poll(async () => (await gridInfo(page))!.cards).toBeGreaterThan(before);
    await expect(page).toHaveURL(/[?&]show=\d+/);
    const expanded = (await gridInfo(page))!.cards;

    await page.locator("article").nth(expanded - 1).locator("a").first().click();
    await page.waitForURL(/\/products\//);
    await page.goBack();
    await page.waitForURL(/\/shop/);
    await expect.poll(async () => (await gridInfo(page))?.cards).toBe(expanded);
  });

  test("the filter drawer shows a live result count, Clear all, and active-filter chips", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await page.getByRole("button", { name: "Filter", exact: true }).click();

    const drawer = page.getByRole("dialog", { name: "Shop filters" });
    await expect(drawer.getByRole("button", { name: /^Show \d+ products?$/ })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Clear all" })).toBeDisabled();

    await drawer.getByRole("button", { name: "M", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "Clear all" })).toBeEnabled();

    await drawer.getByRole("button", { name: /^Show \d+ products?$/ }).click();
    await expect(drawer).toBeHidden();

    // The Filter button now announces the active count, and the chip row names the facet.
    await expect(page.getByRole("button", { name: "Filter, 1 active" })).toBeVisible();
    const chip = page.getByRole("button", { name: "Remove filter: Size M" });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
  });
});

/**
 * F-021 follow-up: a product card in the 2-column phone grid is only ~138px
 * (320px viewport) to ~166px (375px) wide and `overflow-hidden`, so a row that
 * doesn't fit isn't scrolled to or reported — it is just cut off. The review
 * rating (five stars + number + count, ~135px) was exactly that: with the first
 * approved review on a product, its number and count vanished from every phone
 * listing. A freshly seeded catalogue has no reviews, so this test cannot rely
 * on the catalogue to contain a rated card: cards that have no rating get one
 * added to their price row: the real StarRating markup, with a three-digit
 * review count as the widest realistic case (see helpers/rated-card-fixture.ts,
 * which star-rating.test.ts keeps in step with the component). The card's own
 * price row — the part that has to make room for it — is the real one.
 */
test.describe("Mobile listings: rated and sale cards fit their card (F-021)", () => {
  for (const { width, height } of SMALL_PHONES) {
    test.describe(`${width}x${height}`, () => {
      test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

      test("nothing inside a card extends past the card's edges", async ({ page }) => {
        await gotoAndSettle(page, "/shop");
        await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });

        const result = await page.evaluate((html) => {
          const cards = Array.from(document.querySelectorAll("article")).slice(0, 24);
          let rated = 0;
          const overflowing: { card: string; element: string; text: string; overBy: number }[] = [];

          for (const card of cards) {
            if (!card.querySelector("svg.lucide-star")) {
              // The price paragraph's parent is the price group, whose parent
              // is the row the rating sits in.
              const priceRow = card.querySelector("p.font-display")?.parentElement?.parentElement;
              priceRow?.insertAdjacentHTML("beforeend", html);
            }
            if (card.querySelector("svg.lucide-star")) rated += 1;
          }

          for (const card of cards) {
            const box = card.getBoundingClientRect();
            for (const el of Array.from(card.querySelectorAll("*"))) {
              // SVG internals follow their <svg>; photos are `fill`/object-cover
              // inside their own overflow-hidden frame.
              if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
              if (el.tagName === "IMG") continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue; // display: none below this breakpoint
              const overBy = Math.max(r.right - box.right, box.left - r.left);
              if (overBy > 0.5) {
                overflowing.push({
                  card: card.querySelector("h3")?.textContent ?? "?",
                  element: el.tagName.toLowerCase(),
                  text: (el.textContent ?? "").trim().slice(0, 30),
                  overBy: Math.round(overBy),
                });
              }
            }
          }
          return { cards: cards.length, rated, overflowing: overflowing.slice(0, 5) };
        }, CONDENSED_RATING_HTML);

        expect(result.rated, "cards carrying a rating (so this test measures something)").toBeGreaterThan(0);
        expect(result.overflowing, "elements cut off by the card edge").toEqual([]);
      });
    });
  }
});

test.describe("Touch targets (F-240)", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  async function expectAtLeast24px(controls: Locator) {
    const count = await controls.count();
    expect(count, "controls to measure").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect(box.width, `control ${i} width`).toBeGreaterThanOrEqual(24);
      expect(box.height, `control ${i} height`).toBeGreaterThanOrEqual(24);
    }
  }

  test("hero slide dots are at least 24x24", async ({ page }) => {
    await gotoAndSettle(page, "/");
    await expectAtLeast24px(page.getByRole("button", { name: /^Go to slide/ }));
  });

  test("product-card colour swatches are at least 24x24", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });
    await expectAtLeast24px(page.locator('article button[aria-label^="Preview"]'));
  });

  test("cart drawer quantity steppers and Remove are at least 24x24", async ({ page }) => {
    const productsResponse = await page.request.get("/api/products");
    expect(productsResponse.ok()).toBeTruthy();
    const { products } = (await productsResponse.json()) as { products: { handle: string }[] };

    await gotoAndSettle(page, `/products/${products[0].handle}`);
    // `.first()`: on a phone the PDP has a second, sticky add-to-cart bar.
    await page.getByRole("button", { name: /add to cart/i }).first().click();
    const cart = page.getByRole("dialog", { name: "Shopping cart" });
    await expect(cart).toBeVisible();

    await expectAtLeast24px(cart.getByRole("button", { name: "Decrease quantity" }));
    await expectAtLeast24px(cart.getByRole("button", { name: "Increase quantity" }));
    await expectAtLeast24px(cart.getByRole("button", { name: "Remove", exact: true }));
  });
});
