import { test, expect } from "@playwright/test";

import { createGalleryFixture, refreshCatalogueCache, type GalleryFixture } from "./helpers/gallery-fixture";
import { targetIsLocal } from "./helpers/target";

test.describe("Storefront E2E", () => {
  test("homepage loads with brand and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /DAAKYKA/i }).first()).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    // "Shop" is a mega-menu trigger button (not a link) since Phase C2's
    // header rewrite — it opens a dropdown of category tiles on click.
    await expect(page.getByRole("navigation").getByRole("button", { name: "Shop", exact: true })).toBeVisible();
  });

  test("homepage presents Kids Wear before Hospitals and School Uniforms", async ({ page }) => {
    await page.goto("/");
    const categories = page.locator("section").filter({ has: page.getByRole("heading", { name: "Shop by Category" }) });
    await expect(categories.locator('a[href="/kids-wear"]')).toBeVisible();
    const sectionLinks = await categories.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(sectionLinks.slice(0, 3)).toEqual(["/kids-wear", "/for-hospitals", "/school-uniforms"]);
    const bandPositions = await Promise.all([
      "Browse Kids Wear", "Browse Hospital Range", "Browse School Range",
    ].map((name) => page.getByRole("link", { name, exact: true }).evaluate((link) => link.getBoundingClientRect().top + window.scrollY)));
    expect(bandPositions[1]).toBeGreaterThan(bandPositions[0]);
    expect(bandPositions[2]).toBeGreaterThan(bandPositions[1]);
  });

  test("skip to main content link exists", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeAttached();
  });

  test("shop page lists products", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("heading", { name: /shop/i })).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });
  });

  test("product detail and add to cart", async ({ page }) => {
    const productsResponse = await page.request.get("/api/products");
    expect(productsResponse.ok()).toBeTruthy();
    const { products } = (await productsResponse.json()) as { products: { handle: string }[] };
    const handle = products[0].handle;

    await page.goto(`/products/${handle}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("dialog", { name: "Shopping cart" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to Checkout|Checkout/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test("checkout page after adding to cart", async ({ page }) => {
    const productsResponse = await page.request.get("/api/products");
    const { products } = (await productsResponse.json()) as { products: { handle: string }[] };

    await page.goto(`/products/${products[0].handle}`);
    await page.getByRole("button", { name: /add to cart/i }).click();
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  test("checkout empty cart state", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: /cart is empty/i })).toBeVisible();
  });

  test("guides hub and guide page", async ({ page }) => {
    await page.goto("/guides");
    await expect(page.getByRole("heading", { name: /Medical Apparel Guides/i })).toBeVisible();
    await page.goto("/guides/medical-scrubs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Medical Scrubs/i);
    await expect(page.getByRole("heading", { name: /Frequently Asked Questions/i })).toBeVisible();
  });

  test("collections page", async ({ page }) => {
    await page.goto("/collections");
    await expect(page.getByRole("heading", { name: /Collections/i })).toBeVisible();
  });

  test("bulk orders form validation", async ({ page }) => {
    await page.goto("/bulk-orders");
    await page.getByRole("button", { name: "Submit Enquiry" }).click();
    await expect(page.locator("text=/required|organization|contact/i").first()).toBeVisible({
      timeout: 5000,
    });
  });

  // F-154: checkout's "Having trouble? Contact us" link lands on help copy with
  // the form already on Product Support, not the old "Checkout is being connected".
  test("checkout help link opens a support-ready contact page", async ({ page }) => {
    await page.goto("/contact?intent=checkout");
    await expect(page.getByRole("heading", { name: "Need Help With Your Order?", level: 1 })).toBeVisible();
    await expect(page.getByText(/being connected/i)).toHaveCount(0);
    await expect(page.getByLabel("Enquiry Type")).toHaveValue("SUPPORT");
  });

  // F-131: a signed-out visitor following a deep account link is sent to sign in
  // and returned to that exact page, not to /account.
  test("a signed-out deep account link keeps its destination through sign-in", async ({ page }) => {
    await page.goto("/account/orders/DK-2026-0000000001");
    await expect(page).toHaveURL(/\/account\/login\?returnTo=%2Faccount%2Forders%2FDK-2026-0000000001$/);
  });

  test("newsletter rejects without consent", async ({ page }) => {
    await page.goto("/");
    const response = await page.request.post("/api/newsletter/subscribe", {
      data: { email: "e2e-test@example.com", consentGiven: false },
    });
    expect(response.status()).toBe(400);
  });

  test("shop category filter narrows products", async ({ page }) => {
    await page.goto("/shop");
    const initialCount = await page.locator("article").count();
    expect(initialCount).toBeGreaterThan(0);
    // The desktop filter sidebar lists top-level menu categories from the
    // draft catalog (For Hospitals, School Uniforms, Kids Wear), each
    // button showing a trailing product count — unlike the header's
    // "For Hospitals" mega-menu trigger, which has no count and would
    // otherwise make this locator ambiguous.
    await page.getByRole("button", { name: /^For Hospitals \d+$/ }).click();
    await expect(page.locator("article").first()).toBeVisible();
    const filteredCount = await page.locator("article").count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test("desktop navigation opens a populated category", async ({ page }) => {
    await page.goto("/");
    const shopTrigger = page.getByRole("navigation").getByRole("button", { name: "Shop", exact: true });
    await shopTrigger.click();
    await expect(page.getByRole("region", { name: "Shop menu" })).toBeVisible();
    await shopTrigger.click();
    await expect(page.getByRole("region", { name: "Shop menu" })).toHaveCount(0);
    await shopTrigger.click();
    await page.getByRole("region", { name: "Shop menu" }).getByRole("link", { name: "For Hospitals", exact: true }).click();
    await expect(page).toHaveURL(/\/for-hospitals$/);
    await expect(page.locator("article").first()).toBeVisible();
    await page.getByRole("navigation").getByRole("button", { name: "For Hospitals", exact: true }).click();
    await page.getByRole("region", { name: "For Hospitals menu" }).getByRole("link", { name: "Scrub Sets", exact: true }).click();
    await expect(page).toHaveURL(/\/category\/scrub-sets$/);
    await expect(page.locator("article")).toHaveCount(4);
  });

  test("mobile navigation opens a populated category", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: /open menu/i }).click();
    const drawer = page.getByRole("dialog", { name: "Site navigation" });
    await drawer.getByRole("button", { name: "For Hospitals", exact: true }).click();
    await drawer.getByRole("link", { name: "Scrub Sets", exact: true }).click();
    await expect(page).toHaveURL(/\/category\/scrub-sets$/);
    await expect(page.locator("article")).toHaveCount(4);
  });

  test("mobile navigation drawer opens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: /open menu/i }).click();
    const drawer = page.getByRole("dialog", { name: "Site navigation" });
    await expect(drawer).toBeVisible();
    // "Shop" is an accordion trigger button in the mobile drawer too;
    // expanding it reveals a "View all Shop" link into the category.
    await drawer.getByRole("button", { name: "Shop", exact: true }).click();
    await expect(drawer.getByRole("link", { name: "View all Shop" })).toBeVisible();
  });

  test("about page shows founders and client logos", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "Meet the Founders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trusted by Leading Organizations" })).toBeVisible();
    // Authentic client logos are optional uploads; the name remains visible
    // as text until the owner supplies the actual trademark artwork.
    await expect(page.getByText("KIMS Hospitals", { exact: true })).toBeVisible();
  });

  test("institutional page redirects to For Hospitals landing page", async ({ page }) => {
    // Phase C3 retired the standalone /institutional page; it now
    // permanently redirects to the section landing page.
    await page.goto("/institutional");
    await expect(page).toHaveURL(/\/for-hospitals$/);
    await expect(page.getByRole("heading", { name: "For Hospitals", level: 1 })).toBeVisible();
  });

  test("product gallery thumbnail switches main image", async ({ page, request }) => {
    const productsResponse = await page.request.get("/api/products");
    const { products } = (await productsResponse.json()) as { products: { handle: string; name: string }[] };
    expect(products.length, "the catalogue has no published products").toBeGreaterThan(0);

    // The gallery shows only the photos of the selected colour and size, so
    // whether a product has thumbnails depends on its data — look at the page
    // itself rather than guessing from the product list.
    const secondThumbnailOf = (name: string) =>
      page.getByRole("button", { name: new RegExp(`View ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} image 2`, "i") });

    let chosen: { handle: string; name: string } | undefined;
    for (const product of products.slice(0, 6)) {
      await page.goto(`/products/${product.handle}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if ((await secondThumbnailOf(product.name).count()) > 0) {
        chosen = product;
        break;
      }
    }

    // A catalogue with no multi-photo product (the seeded CI one has no photos
    // at all) must not turn this into a skip that never tests anything: on a
    // local server the test gives a product a two-photo gallery and cleans up.
    let fixture: GalleryFixture | undefined;
    try {
      if (!chosen) {
        expect(
          targetIsLocal,
          "none of the first products has a gallery with two or more photos, and a fixture can only be added on a local server",
        ).toBe(true);
        chosen = products[0];
        fixture = await createGalleryFixture(chosen.handle);
        await refreshCatalogueCache(request, fixture.productId);
        await page.goto(`/products/${chosen.handle}`);
      }

      const mainImage = page.locator(".relative.aspect-\\[4\\/5\\] img").first();
      const initialSrc = await mainImage.getAttribute("src");
      const secondThumbnail = secondThumbnailOf(chosen.name);
      await expect(secondThumbnail).toHaveCount(1);
      await secondThumbnail.click();
      await expect(mainImage).not.toHaveAttribute("src", initialSrc ?? "");
    } finally {
      if (fixture) {
        await fixture.remove();
        // Forget the fixture photos so no later test sees them.
        await refreshCatalogueCache(request, fixture.productId);
      }
    }
  });
});
