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
