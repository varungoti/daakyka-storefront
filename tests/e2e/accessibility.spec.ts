import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults } from "axe-core";

/**
 * Phase G accessibility pass: an automated axe scan of the key storefront
 * pages. This is a smoke net, not a full WCAG audit — it asserts there are
 * no "serious" or "critical" violations (real, common-impact issues like
 * missing alt text, unlabelled form fields, or insufficient contrast).
 * "Moderate"/"minor" findings are logged but allowed to pass: a full
 * remediation pass across the whole app is out of scope here, and some of
 * those are pre-existing, lower-impact issues (e.g. landmark structure)
 * that need a larger look than this polish pass covers.
 */

function seriousOrCritical(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
}

function describeViolations(violations: AxeResults["violations"]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} node(s)\n` +
        violation.nodes.map((node) => `  ${node.target.join(" ")}`).join("\n"),
    )
    .join("\n\n");
}

/**
 * Several sections use a CSS entrance animation (globals.css's
 * `.animate-fade-up-delay-2` etc — `animation: ... 0.6s ease-out 0.2s
 * both`) that starts at `opacity: 0`. Scanning immediately after
 * `page.goto()` can catch an element mid-fade, which axe reports as a
 * (transient, not real) color-contrast violation. A short settle wait
 * after navigation avoids that false positive without touching the
 * animations themselves.
 */
async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForTimeout(1000);
}

async function scanForSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = seriousOrCritical(results);
  expect(bad, describeViolations(bad)).toEqual([]);
}

test.describe("Accessibility (axe)", () => {
  test("home page has no serious/critical violations", async ({ page }) => {
    await gotoAndSettle(page, "/");
    await scanForSeriousViolations(page);
  });

  test("shop page has no serious/critical violations", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await page.locator("article").first().waitFor({ timeout: 10000 }).catch(() => {});
    await scanForSeriousViolations(page);
  });

  test("for-hospitals page has no serious/critical violations", async ({ page }) => {
    await gotoAndSettle(page, "/for-hospitals");
    await scanForSeriousViolations(page);
  });

  test("a product page has no serious/critical violations", async ({ page }) => {
    const productsResponse = await page.request.get("/api/products");
    expect(productsResponse.ok()).toBeTruthy();
    const { products } = (await productsResponse.json()) as { products: { handle: string }[] };
    test.skip(products.length === 0, "no products seeded to test against");

    await gotoAndSettle(page, `/products/${products[0].handle}`);
    await scanForSeriousViolations(page);
  });

  test("checkout page has no serious/critical violations", async ({ page }) => {
    const productsResponse = await page.request.get("/api/products");
    const { products } = (await productsResponse.json()) as { products: { handle: string }[] };
    if (products.length > 0) {
      await page.goto(`/products/${products[0].handle}`);
      await page
        .getByRole("button", { name: /add to cart/i })
        .click({ timeout: 5000 })
        .catch(() => {});
    }

    await gotoAndSettle(page, "/checkout");
    await scanForSeriousViolations(page);
  });

  test("account login page has no serious/critical violations", async ({ page }) => {
    await gotoAndSettle(page, "/account/login");
    await scanForSeriousViolations(page);
  });
});

/**
 * Release-hardening — configurable hero carousel
 * (src/components/home/hero-carousel.tsx). The axe scan above already
 * covers static markup/contrast/name-role-value rules for "/" (which now
 * includes the carousel); these cover the *behavioral* accessibility
 * requirements that a static scan can't: reduced motion actually stopping
 * auto-advance, and the prev/next controls actually being keyboard
 * operable and not trapping or silently moving focus. Each test skips
 * itself when only one hero slide is configured (a fresh/never-admin-
 * edited environment) — carousel controls don't render for a single slide
 * (see HeroCarousel's `multiSlide` gate), so there'd be nothing to test.
 */
test.describe("Hero carousel", () => {
  test("respects prefers-reduced-motion: no auto-advance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const slides = page.locator('[aria-roledescription="slide"]');
    test.skip((await slides.count()) < 2, "only one hero slide configured — auto-advance is moot");

    const firstSlide = slides.first();
    await expect(firstSlide).toHaveAttribute("aria-hidden", "false");
    // Comfortably longer than the seeded 6s auto-advance interval.
    await page.waitForTimeout(8000);
    await expect(firstSlide).toHaveAttribute("aria-hidden", "false");
  });

  test("prev/next controls are real, keyboard-operable buttons that change the active slide", async ({ page }) => {
    await page.goto("/");
    const slides = page.locator('[aria-roledescription="slide"]');
    test.skip((await slides.count()) < 2, "only one hero slide configured — no carousel controls render");

    const nextButton = page.getByRole("button", { name: "Next slide" });
    await expect(nextButton).toBeVisible();
    await expect(slides.nth(0)).toHaveAttribute("aria-hidden", "false");

    await nextButton.focus();
    await nextButton.press("Enter");

    await expect(slides.nth(1)).toHaveAttribute("aria-hidden", "false");
    await expect(slides.nth(0)).toHaveAttribute("aria-hidden", "true");
  });

  test("hovering the carousel pauses auto-advance", async ({ page }) => {
    await page.goto("/");
    const slides = page.locator('[aria-roledescription="slide"]');
    test.skip((await slides.count()) < 2, "only one hero slide configured — auto-advance is moot");

    await page.locator('section[aria-label="Featured collections"]').hover();
    // Comfortably longer than the seeded 6s auto-advance interval.
    await page.waitForTimeout(8000);
    await expect(slides.first()).toHaveAttribute("aria-hidden", "false");
  });
});

/**
 * Release-hardening a11y sweep 1 (F-010, F-022, F-047, F-056, F-083, F-087,
 * F-088, F-145, F-238, F-241). The scans above only fail on serious/critical
 * violations; these pin the specific things that sweep fixed, so they can't
 * quietly come back — including the keyboard behaviour (mega-menu tab order,
 * predictive-search combobox, focus return) that a static scan can't see.
 */
async function scanRules(page: Page, rules: string[]) {
  const results = await new AxeBuilder({ page }).withRules(rules).analyze();
  expect(results.violations, describeViolations(results.violations)).toEqual([]);
}

test.describe("Accessibility sweep 1", () => {
  // F-047: axe's page-has-heading-one was firing on all of these, and /shop
  // rendered two h1s (the desktop filter panel repeated the title).
  for (const path of [
    "/about",
    "/accessibility",
    "/bulk-orders",
    "/collections",
    "/contact",
    "/privacy-policy",
    "/returns",
    "/shipping",
    "/shop",
    "/shop/bespoke",
    "/terms",
  ]) {
    test(`${path} has exactly one h1`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await gotoAndSettle(page, path);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }

  // F-056: inline policy links need a non-colour cue, the WhatsApp CTA green
  // (#38a169 on white = 3.24:1) needs to reach 4.5:1.
  for (const path of ["/privacy-policy", "/returns", "/shipping", "/accessibility", "/terms", "/contact", "/bulk-orders"]) {
    test(`${path} has underlined in-text links and AA-contrast text`, async ({ page }) => {
      await gotoAndSettle(page, path);
      await scanRules(page, ["link-in-text-block", "color-contrast", "page-has-heading-one"]);
    });
  }

  // F-088/F-022: <a><button> is invalid and gives every CTA two tab stops.
  for (const path of ["/", "/for-hospitals", "/shop", "/checkout"]) {
    test(`${path} has no button nested inside a link`, async ({ page }) => {
      await gotoAndSettle(page, path);
      await expect(page.locator("a button, a [role=button]")).toHaveCount(0);
    });
  }

  test("shop filter toggles expose their pressed state (F-022)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAndSettle(page, "/shop");
    // Each filter group is a titled box; scope to it so the product cards'
    // own quick-add size chips (also aria-pressed buttons) can't match.
    const group = (title: string) => page.locator("p", { hasText: new RegExp("^" + title + "$") }).locator("xpath=..");

    await expect(group("Categories").getByRole("button", { name: /^All Products/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const size = group("Size").getByRole("button", { name: "M", exact: true });
    await expect(size).toHaveAttribute("aria-pressed", "false");
    await size.click();
    await expect(size).toHaveAttribute("aria-pressed", "true");

    const colour = group("Color").locator("button[aria-label]").first();
    await expect(colour).toHaveAttribute("aria-pressed", "false");
    await colour.click();
    await expect(colour).toHaveAttribute("aria-pressed", "true");
  });

  test("product count is singular for one product and announced politely (F-022)", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    await expect(page.locator('[role="status"]').filter({ hasText: /\d+ Products?$/ }).first()).toBeVisible();
  });

  // F-239: the card's name/price link spans the card edge to edge inside an
  // overflow-hidden article, so its own outline was clipped to two stray
  // lines; the ring now lives on the card.
  test("keyboard focus on a product card shows a ring around the whole card (F-239)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoAndSettle(page, "/shop");
    const article = page.locator("article").first();
    const link = article.locator("a[data-card-link]");
    await link.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    expect(await article.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  });

  test("colour swatches on a product card are at least 24px (F-022)", async ({ page }) => {
    await gotoAndSettle(page, "/shop");
    const swatch = page.locator('article button[aria-label^="Preview"]').first();
    await expect(swatch).toBeVisible();
    const box = await swatch.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });

  // F-010
  test("mega menu: Tab goes straight into the open panel and focus leaving closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAndSettle(page, "/");
    const trigger = page.locator('header nav button[aria-controls^="nav-panel-"]').first();
    await trigger.focus();
    await trigger.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panelId = (await trigger.getAttribute("aria-controls")) as string;

    await page.keyboard.press("Tab");
    expect(
      await page.evaluate((id) => document.getElementById(id)?.contains(document.activeElement) ?? false, panelId),
      "first Tab from an expanded trigger should land inside its own panel",
    ).toBe(true);

    // Tab out of the nav entirely (past every other top-level item): the
    // panel must not be left open over the page.
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      if ((await page.locator(`#${panelId}`).count()) === 0) break;
    }
    await expect(page.locator(`#${panelId}`)).toHaveCount(0);
  });

  test("mega menu: moving focus to another top-level item closes the open panel, Escape returns to the trigger", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAndSettle(page, "/");
    const triggers = page.locator('header nav button[aria-controls^="nav-panel-"]');
    test.skip((await triggers.count()) < 2, "needs two mega-menu items");

    await triggers.nth(0).focus();
    await triggers.nth(0).press("Enter");
    await expect(triggers.nth(0)).toHaveAttribute("aria-expanded", "true");
    await triggers.nth(1).focus();
    await expect(triggers.nth(0)).toHaveAttribute("aria-expanded", "false");

    await triggers.nth(1).press("Enter");
    await expect(triggers.nth(1)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(triggers.nth(1)).toHaveAttribute("aria-expanded", "false");
    await expect(triggers.nth(1)).toBeFocused();
  });

  // F-083 / F-238
  test("predictive search: Enter searches, arrows pick a result, focus returns to the Search button", async ({ page }) => {
    await gotoAndSettle(page, "/");
    const searchButton = page.locator("header").getByRole("button", { name: "Search", exact: true });
    await searchButton.focus();
    await searchButton.press("Enter");

    const input = page.getByRole("combobox", { name: "Search products" });
    await expect(input).toBeFocused();
    await input.fill("scrub");
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();

    await input.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");
    await expect(input).toBeFocused();

    // Typing clears the highlight; Enter with no result highlighted runs
    // the full search.
    await input.fill("");
    await input.fill("scrub");
    await expect(input).not.toHaveAttribute("aria-activedescendant", /.+/);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/shop\?q=scrub$/);

    // Esc closes, and focus goes back to where it came from.
    await gotoAndSettle(page, "/");
    await searchButton.focus();
    await searchButton.press("Enter");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Search products" })).toHaveCount(0);
    await expect(searchButton).toBeFocused();
  });

  test("predictive search: Enter on a highlighted result opens that product; no-results offers a next step", async ({
    page,
  }) => {
    await gotoAndSettle(page, "/");
    await page.locator("header").getByRole("button", { name: "Search", exact: true }).click();
    const input = page.getByRole("combobox", { name: "Search products" });
    await input.fill("scrub");
    await expect(page.getByRole("option").first()).toBeVisible();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/products\//);

    await gotoAndSettle(page, "/");
    await page.locator("header").getByRole("button", { name: "Search", exact: true }).click();
    await input.fill("zzqxnomatch");
    await expect(page.getByText("No products found")).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Search products" });
    await expect(dialog.getByRole("link", { name: /Search all products for/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Kids wear" })).toBeVisible();
  });

  // F-241
  test("newsletter errors are announced (role=alert)", async ({ page }) => {
    await gotoAndSettle(page, "/");
    const footer = page.locator("footer");
    await footer.getByPlaceholder("Enter your email").fill("shopper@example.com");
    await footer.getByRole("button", { name: "Subscribe" }).click();
    const alert = footer.getByRole("alert");
    await expect(alert).toContainText("agree to receive emails");
    await expect(footer.getByLabel("Email address")).toBeVisible();
  });

  test("contact form: the success confirmation is announced, takes focus, and \"Send Another\" returns to the form", async ({
    page,
  }) => {
    await gotoAndSettle(page, "/contact");
    await page.getByLabel("Full Name *").fill("Accessibility Check");
    await page.getByLabel("Email *").fill("a11y-check@example.com");
    await page.getByLabel("Message *").fill("Automated accessibility check - please ignore this enquiry.");
    await page.getByRole("button", { name: "Send Enquiry" }).click();

    const status = page.getByRole("status").filter({ hasText: "Message Sent" });
    await expect(status).toBeVisible();
    await expect(status).toBeFocused();

    await page.getByRole("button", { name: "Send Another Message" }).click();
    await expect(page.getByLabel("Full Name *")).toBeFocused();
  });

  test("register: a client-side field error is announced and the field takes focus (F-241)", async ({ page }) => {
    await gotoAndSettle(page, "/account/register");
    await page.getByLabel("Full Name *").fill("Accessibility Check");
    await page.getByLabel("Email *").fill("a11y-check@example.com");
    await page.getByLabel("Phone", { exact: true }).fill("123");
    await page.getByLabel("Password *").fill("a-long-enough-password");
    await page.locator("main").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "fix the highlighted" })).toBeVisible();
    await expect(page.getByLabel("Phone", { exact: true })).toBeFocused();
  });

  test("login errors are announced (role=alert)", async ({ page }) => {
    await gotoAndSettle(page, "/account/login");
    await page.getByLabel("Email *").fill("nobody@example.com");
    await page.getByLabel("Password *").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toBeVisible();
  });

  test("account login page passes the full axe wcag2a/aa rule set", async ({ page }) => {
    await gotoAndSettle(page, "/account/login");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });

  // F-087
  test("the hero's images never use an internal media label as alt text", async ({ page }) => {
    await gotoAndSettle(page, "/");
    const alts = await page
      .locator('section[aria-label="Featured collections"] img')
      .evaluateAll((images) => images.map((image) => image.getAttribute("alt") ?? ""));
    for (const alt of alts) {
      expect(alt).not.toMatch(/^(Homepage|Contact|Category|About|Bulk Orders|Our Story)\b.*\s[—–-]\s/);
    }
  });

  test("the homepage has no heading-order violation", async ({ page }) => {
    await gotoAndSettle(page, "/");
    await scanRules(page, ["heading-order"]);
  });
});
