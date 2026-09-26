import { test, expect } from "@playwright/test";

/**
 * Release-audit checkout-page-ux-integrity package (F-034, F-115, F-116,
 * F-117): behaviours that only show up with a real browser — focus/scroll
 * on mobile, keyboard handling, and the live quote endpoint actually
 * agreeing with what the page renders. tests/e2e/storefront.spec.ts already
 * covers the happy path (add to cart, land on /checkout); this file only
 * adds the specific regressions those findings called out.
 */

interface CartLine {
  variantId: string;
  quantity: number;
}

async function addFirstProductToCart(page: import("@playwright/test").Page) {
  const productsResponse = await page.request.get("/api/products");
  expect(productsResponse.ok()).toBeTruthy();
  const { products } = (await productsResponse.json()) as { products: { handle: string }[] };

  await page.goto(`/products/${products[0].handle}`);
  await page.getByRole("button", { name: /add to cart/i }).click();
  await expect(page.getByRole("dialog", { name: "Shopping cart" })).toBeVisible();
}

async function fillValidCheckoutDetails(page: import("@playwright/test").Page) {
  await page.getByLabel("Full name").fill("Audit Tester");
  await page.getByLabel("Phone").fill("9876543210");
  await page.getByLabel("Email").fill(`checkout-e2e-${Date.now()}@example.com`);
  await page.getByLabel("Address line 1").fill("221B Test Street");
  await page.getByLabel("City").fill("Hyderabad");
  await page.getByLabel("State").selectOption("Telangana");
  await page.getByLabel("Pincode").fill("500032");
}

test.describe("Checkout page UX (release-hardening)", () => {
  // F-117: Enter in the "Have a discount code?" field used to submit the
  // whole form at full price instead of applying the code.
  test("pressing Enter in the discount-code field applies the code instead of placing the order", async ({
    page,
  }) => {
    await addFirstProductToCart(page);
    await page.goto("/checkout");
    await fillValidCheckoutDetails(page);

    const discountRequest = page.waitForRequest(
      (req) => req.url().includes("/api/checkout/discount") && req.method() === "POST",
    );
    await page.getByPlaceholder("Enter code").fill("NOT-A-REAL-CODE");
    await page.getByPlaceholder("Enter code").press("Enter");

    // The Enter key must be routed to the discount preview, never to the
    // order submission — regardless of whether the typed code is valid.
    await discountRequest;
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  // F-034: on mobile, an invalid phone/pincode left the error ~1000px
  // above the viewport with focus still on the button, so "Place Order"
  // looked like it silently did nothing.
  test("on mobile, an invalid phone submit scrolls the field into view and focuses it", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await addFirstProductToCart(page);
    await page.goto("/checkout");
    await fillValidCheckoutDetails(page);

    const phoneInput = page.getByLabel("Phone");
    await phoneInput.fill("12345"); // too short to pass normalizeIndianPhone
    await page.getByRole("button", { name: /place order/i }).click();

    await expect(phoneInput).toBeFocused();
    await expect(phoneInput).toBeInViewport();
    await expect(page.getByRole("alert")).toBeInViewport();
  });

  // F-115/F-116: the page must show the same Shipping/Total the server
  // would actually charge, not "calculated at the next step" or a stale
  // add-to-cart-time price.
  test("the displayed total matches POST /api/checkout/quote for the same cart", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/checkout");

    const totalRow = page.getByText("Total", { exact: true }).locator("..").getByText(/₹/);
    await expect(totalRow).not.toHaveText(/Calculating/, { timeout: 10000 });

    const cartRaw = await page.evaluate(() => window.localStorage.getItem("daakyka-cart"));
    expect(cartRaw).toBeTruthy();
    const cart = JSON.parse(cartRaw as string) as { lines: CartLine[] };

    const quoteResponse = await page.request.post("/api/checkout/quote", {
      data: { items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })) },
    });
    expect(quoteResponse.ok()).toBeTruthy();
    const quote = (await quoteResponse.json()) as { total: number };

    const totalText = (await totalRow.textContent()) ?? "";
    const shownTotal = Number(totalText.replace(/[^\d.]/g, ""));
    expect(shownTotal).toBe(quote.total);
  });
});
