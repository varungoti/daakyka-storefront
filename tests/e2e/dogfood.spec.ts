import { test, expect } from "@playwright/test";
import { seoLandingPages } from "@/data/seo-landing-pages";

import {
  DEFAULT_ADMIN_SEED_EMAIL,
  DEFAULT_ADMIN_SEED_PASSWORD,
} from "@/lib/auth/seed-defaults";

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? DEFAULT_ADMIN_SEED_PASSWORD;

const STOREFRONT_ROUTES = [
  "/",
  "/shop",
  "/mix-and-match",
  "/mix-and-match/studio",
  "/fabric-technology",
  "/science-of-the-scrub",
  "/bulk-orders",
  "/institutional",
  "/about",
  "/contact",
  "/blog",
  "/collections",
  "/guides",
  "/checkout",
  "/size-guide",
  "/shipping",
  "/returns",
  "/privacy-policy",
  "/terms",
  "/accessibility",
  "/shop/bespoke",
];

test.describe("Dogfood — storefront crawl", () => {
  for (const route of STOREFRONT_ROUTES) {
    test(`page loads without console errors: ${route}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(err.message));

      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
      await page.screenshot({
        path: `dogfood-output/screenshots/storefront${route.replace(/\//g, "-") || "-home"}.png`,
        fullPage: true,
      });

      const ignorable = consoleErrors.filter(
        (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("hydration"),
      );
      expect(ignorable, `Console errors on ${route}: ${ignorable.join("; ")}`).toEqual([]);
    });
  }

  for (const guide of seoLandingPages) {
    test(`guide page loads: /guides/${guide.slug}`, async ({ page }) => {
      const response = await page.goto(`/guides/${guide.slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

test.describe("Dogfood — interactive flows", () => {
  test("currency toggle INR ↔ USD on shop", async ({ page }) => {
    await page.goto("/shop");
    const currencyButton = page.getByRole("button", { name: /INR|USD|₹|\$/i }).first();
    await expect(currencyButton).toBeVisible();
    await currencyButton.click();
    await page.screenshot({ path: "dogfood-output/screenshots/currency-toggle.png" });
  });

  test("search dialog opens and returns results", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("textbox").fill("scrub");
    await expect(page.locator("article, a[href*='/products/']").first()).toBeVisible({
      timeout: 10000,
    });
    await page.screenshot({ path: "dogfood-output/screenshots/search-dialog.png" });
  });

  test("wishlist add from product page", async ({ page }) => {
    const { products } = (await (await page.request.get("/api/products")).json()) as {
      products: { handle: string }[];
    };
    await page.goto(`/products/${products[0].handle}`);
    await page.getByRole("button", { name: "Add to wishlist" }).first().click();
    await page.getByRole("button", { name: "Wishlist", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /wishlist/i })).toBeVisible();
    await page.screenshot({ path: "dogfood-output/screenshots/wishlist-drawer.png" });
  });

  test("mix-and-match builder loads", async ({ page }) => {
    await page.goto("/mix-and-match");
    await expect(page.getByRole("heading", { name: /mix/i })).toBeVisible();
    await page.screenshot({ path: "dogfood-output/screenshots/mix-and-match.png", fullPage: true });
  });

  test("mix-and-match studio AR try-on updates preview", async ({ page }) => {
    await page.goto("/mix-and-match/studio");
    await expect(page.getByRole("heading", { name: /mix, match/i })).toBeVisible({ timeout: 15000 });

    const preview = page.locator(".configurator-stage img").first();
    await expect(preview).toBeVisible({ timeout: 20000 });

    const initialSrc = await preview.getAttribute("src");
    expect(initialSrc).toBeTruthy();

    await page.getByRole("button", { name: "Mandarin" }).click();
    await expect
      .poll(async () => preview.getAttribute("src"), { timeout: 30000 })
      .not.toBe(initialSrc);

    await page.screenshot({
      path: "dogfood-output/screenshots/mix-match-studio-ar.png",
      fullPage: true,
    });

    await expect(page.getByText(/AR try-on render|Live garment preview/i)).toBeVisible();
  });

  test("studio favorites panel applies wishlisted product", async ({ page }) => {
    const { products } = (await (await page.request.get("/api/products")).json()) as {
      products: { handle: string; name: string; category: string }[];
    };
    const top = products.find((p) => p.category === "tops") ?? products[0];
    await page.goto(`/products/${top.handle}`);
    await page.getByRole("button", { name: "Add to wishlist" }).first().click();

    await page.goto("/mix-and-match/studio");
    await expect(page.getByText("Your Favorites")).toBeVisible();
    await page.getByRole("button", { name: top.name }).click();
    await page.screenshot({ path: "dogfood-output/screenshots/studio-favorites.png", fullPage: true });
  });

  test("contact form shows validation", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: /send|submit/i }).click();
    await expect(page.locator("text=/required|email|name/i").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("fabric technology subpages", async ({ page }) => {
    await page.goto("/fabric-technology");
    await page.getByRole("link", { name: /4-way stretch|stretch/i }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("blog post renders", async ({ page }) => {
    await page.goto("/blog/how-to-choose-medical-scrubs");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("collection detail page", async ({ page }) => {
    await page.goto("/collections/best-sellers");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("SEO legacy redirect works", async ({ page }) => {
    await page.goto("/doctor-scrubs");
    await expect(page).toHaveURL(/\/guides\/doctor-scrubs/);
  });

  test("dark mode toggle switches data-theme", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /toggle theme/i });
    await expect(toggle).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: "dogfood-output/screenshots/dark-mode.png" });
  });

  test("WhatsApp FAB links to wa.me with brand message", async ({ page }) => {
    await page.goto("/");
    const fab = page.getByRole("link", { name: /chat on whatsapp/i });
    await expect(fab).toBeVisible();
    const href = await fab.getAttribute("href");
    expect(href).toMatch(/^https:\/\/wa\.me\//);
    expect(href).toContain(encodeURIComponent("Hi DAAKYKA"));
  });
});

test.describe("Dogfood — admin tour", () => {
  const adminRoutes = [
    "/admin/dashboard",
    "/admin/homepage",
    "/admin/blog",
    "/admin/bulk-orders",
    "/admin/contact-enquiries",
    "/admin/testimonials",
    "/admin/users",
    "/admin/segments",
    "/admin/templates",
    "/admin/campaigns",
    "/admin/journeys",
    "/admin/engagement",
    "/admin/hermes",
    "/admin/intelligence",
    "/admin/orders",
    "/admin/reports",
    "/admin/reputation",
    "/admin/seo",
    "/admin/integrations",
    "/admin/audit-logs",
    "/admin/notifications",
    "/admin/market",
    "/admin/offers",
  ];

  test("all admin panel pages load after single login", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15000 });

    for (const route of adminRoutes) {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("main, [role='main'], .admin-content, h1").first()).toBeVisible();
      await page.screenshot({
        path: `dogfood-output/screenshots/admin${route.replace(/\//g, "-")}.png`,
        fullPage: false,
      });
    }
  });
});
