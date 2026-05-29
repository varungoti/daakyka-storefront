import { test, expect } from "@playwright/test";

test.describe("Storefront E2E", () => {
  test("homepage loads with brand and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /DAAKYKA/i }).first()).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Shop", exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: /^Tops\b/ }).click();
    await expect(page.locator("article").first()).toBeVisible();
    const filteredText = await page.locator("text=/\\d+ products?/i").first().textContent();
    expect(filteredText).toBeTruthy();
  });

  test("mobile navigation drawer opens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.getByRole("link", { name: "Shop", exact: true }).first()).toBeVisible();
  });

  test("about page shows founders and client logos", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "Meet the Founders" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trusted by Leading Organizations" })).toBeVisible();
    await expect(page.locator('img[alt*="KIMS"]').first()).toBeVisible();
  });

  test("institutional page shows hero and partner logos", async ({ page }) => {
    await page.goto("/institutional");
    await expect(page.getByRole("heading", { name: /Uniforms & Linens/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Institutional Partners" })).toBeVisible();
  });

  test("product gallery thumbnail switches main image", async ({ page }) => {
    await page.goto("/products/v-neck-top-lilac");
    const mainImage = page.locator(".relative.aspect-\\[4\\/5\\] img").first();
    const initialSrc = await mainImage.getAttribute("src");
    await page.getByRole("button", { name: /View V-Neck Top image 2/i }).click();
    await expect(mainImage).not.toHaveAttribute("src", initialSrc ?? "");
  });
});
