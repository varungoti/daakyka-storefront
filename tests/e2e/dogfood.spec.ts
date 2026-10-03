import { test, expect, type Page } from "@playwright/test";
import { seoLandingPages } from "@/data/seo-landing-pages";

import { resolveAdminCredentials } from "./helpers/admin-credentials";
import { residueWritesAllowed, residueWritesSkipReason } from "./helpers/target";

// F-076: Mix & Match, its try-on studio and Fabric Technology are optional
// pages an admin switches on (SiteSetting pages.mixMatch.enabled /
// pages.fabricTech.enabled), and both are OFF on a default install, so they
// 404 by design. This run is told which state it targets, the same way the
// smoke suite is (tests/smoke/pages.test.ts): the Docker CI gate enables them
// in its disposable database and sets CI_OPTIONAL_PAGES_ENABLED=1. Without it
// the pages must 404 and their flows are skipped, rather than the crawl
// failing on pages that are correctly hidden.
const OPTIONAL_PAGES_ENABLED = process.env.CI_OPTIONAL_PAGES_ENABLED === "1";
const OPTIONAL_PAGES_OFF_REASON =
  "Mix & Match / Fabric Technology are switched off by default (pages.*.enabled); set CI_OPTIONAL_PAGES_ENABLED=1 when they are enabled";
const OPTIONAL_ROUTES = ["/mix-and-match", "/mix-and-match/studio", "/fabric-technology"];

async function loginAsAdmin(page: Page) {
  // Resolved per login, not at module scope, so a missing ADMIN_SEED_PASSWORD
  // fails the admin tests that need it instead of aborting the whole run (F-252).
  const { email, password } = resolveAdminCredentials();
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15000 });
}

const STOREFRONT_ROUTES = [
  "/",
  "/shop",
  ...OPTIONAL_ROUTES,
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
    const switchedOff = OPTIONAL_ROUTES.includes(route) && !OPTIONAL_PAGES_ENABLED;
    test(`${switchedOff ? "optional page is switched off by default" : "page loads without console errors"}: ${route}`, async ({ page }) => {
      if (switchedOff) {
        const response = await page.goto(route);
        expect(response?.status()).toBe(404);
        return;
      }
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
  test("shop description remains in the browser document", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
      "content",
      /kidswear, hospital scrubs and apparel, institutional linens/i,
    );
  });

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
    const dialog = page.getByRole("dialog", { name: "Search products" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Searching...")).toBeHidden({ timeout: 15000 });
    await expect(dialog.locator("a[href*='/products/']").first()).toBeVisible();
    await dialog.getByPlaceholder("Search scrubs, colors, fabrics...").fill("navy");
    await expect(dialog.locator("a[href*='/products/']").first()).toBeVisible({
      timeout: 10000,
    });
    await page.screenshot({ path: "dogfood-output/screenshots/search-dialog.png" });
  });

  test("wishlist add from product page", async ({ page }) => {
    const { products } = (await (await page.request.get("/api/products")).json()) as {
      products: { handle: string }[];
    };
    await page.goto(`/products/${products[0].handle}`);
    await page.getByRole("button", { name: /^Add .+ to wishlist$/ }).first().click();
    // The header button's name carries the count once something is in it ("Wishlist, 1 item").
    await page.getByRole("button", { name: /^Wishlist(,|$)/ }).click();
    await expect(page.getByRole("dialog", { name: /wishlist/i })).toBeVisible();
    await page.screenshot({ path: "dogfood-output/screenshots/wishlist-drawer.png" });
  });

  test("mix-and-match builder loads", async ({ page }) => {
    test.skip(!OPTIONAL_PAGES_ENABLED, OPTIONAL_PAGES_OFF_REASON);
    await page.goto("/mix-and-match");
    await expect(page.getByRole("heading", { name: /mix/i })).toBeVisible();
    await page.screenshot({ path: "dogfood-output/screenshots/mix-and-match.png", fullPage: true });
  });

  test("mix-and-match studio selects a real catalog style and reports missing photos", async ({ page }) => {
    test.skip(!OPTIONAL_PAGES_ENABLED, OPTIONAL_PAGES_OFF_REASON);
    await page.goto("/mix-and-match/studio");
    await expect(page.getByRole("heading", { name: /mix, match/i })).toBeVisible({ timeout: 15000 });

    const preview = page.locator(".configurator-stage img").first();
    await expect(preview).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: "Mandarin" }).click();
    await expect(page.getByText(/Mandarin \+ Jogger/)).toBeVisible();
    await expect(page.getByText(/1,748/)).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Virtual try-on is unavailable for this style until its product photo is uploaded.",
    );

    await page.screenshot({
      path: "dogfood-output/screenshots/mix-match-studio-ar.png",
      fullPage: true,
    });

    await expect(page.getByText("Garment photo unavailable")).toBeVisible();
  });

  test("studio favorites panel applies wishlisted product", async ({ page }) => {
    test.skip(!OPTIONAL_PAGES_ENABLED, OPTIONAL_PAGES_OFF_REASON);
    const { products } = (await (await page.request.get("/api/products")).json()) as {
      products: { handle: string; name: string; category: string }[];
    };
    const top = products.find((p) => p.category === "tops") ?? products[0];
    await page.goto(`/products/${top.handle}`);
    await page.getByRole("button", { name: /^Add .+ to wishlist$/ }).first().click();

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
    test.skip(!OPTIONAL_PAGES_ENABLED, OPTIONAL_PAGES_OFF_REASON);
    await page.goto("/fabric-technology");
    await page.getByRole("link", { name: /4-way stretch|stretch/i }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("blog post renders", async ({ page }) => {
    await page.goto("/blog");
    const href = await page.locator('a[href^="/blog/"]').first().getAttribute("href");
    expect(href).toBeTruthy();
    const response = await page.goto(href!);
    expect(response?.status()).toBe(200);
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

  test("the current light theme has no obsolete dark-mode toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /toggle theme/i })).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
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

test.describe("Dogfood — Hermes & AR APIs", () => {
  test("Hermes runtime health reports minimal liveness for an unauthenticated request", async ({
    request,
  }) => {
    // F4 (docs/audit-2026-09-19/security.md): platform/runtime detail
    // (platform, fireworks, inline, mode) moved behind an authenticated
    // admin session (requireAdminPermission("hermes:manage")) — this
    // unauthenticated `request` fixture carries no admin cookie, so it
    // must only ever see `ok`/`service`, which is all
    // scripts/probe-deploy.mjs needs for liveness.
    const response = await request.get("/api/hermes/runtime/health");
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      inline?: boolean;
      mode?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("daakyka-hermes");
    expect(body.inline).toBeUndefined();
    expect(body.mode).toBeUndefined();
  });

  test("try-on API returns valid preview payload", async ({ request }) => {
    // POSTs to the try-on API, which can call a paid rendering service.
    test.skip(!residueWritesAllowed, residueWritesSkipReason);
    const topImageUrl =
      "https://images.unsplash.com/photo-1666887360684-8082fc98ebd2?auto=format&fit=crop&w=800&q=80";
    const response = await request.post("/api/outfit/try-on", {
      data: { gender: "female", topImageUrl, color: "Navy" },
    });
    // F-304: the endpoint is gated on the same flag as the studio page, so it 404s while
    // Mix & Match is switched off (the default).
    if (!OPTIONAL_PAGES_ENABLED) {
      expect(response.status()).toBe(404);
      return;
    }
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      ok: boolean;
      mode: string;
      resultImageUrl: string;
    };
    expect(body.ok).toBe(true);
    expect(["ar-tryon", "fallback"]).toContain(body.mode);
    expect(body.resultImageUrl).toMatch(/^https?:\/\/|data:image\//);
  });

  test("Hermes admin dispatches task to approval queue", async ({ page }) => {
    // Queues a pending approval that nothing removes afterwards.
    test.skip(!residueWritesAllowed, residueWritesSkipReason);
    test.setTimeout(90_000);
    await loginAsAdmin(page);

    await page.goto("/admin/hermes");
    await expect(page.getByRole("heading", { name: /Hermes Agent/i })).toBeVisible();
    await expect(page.getByText(/Vercel inline|HTTP runtime|Not configured/i).first()).toBeVisible();

    // Exact name: a pending queue item's Approve/Reject buttons are named
    // "Approve Hermes: daily seo health scan", which a substring match would also hit.
    await page.getByRole("button", { name: "Daily SEO Health Scan", exact: true }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeHidden({ timeout: 45_000 });

    await expect(
      page.locator("section").filter({ hasText: "Approval Queue" }).getByText(/PENDING|daily|seo/i).first(),
    ).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: "dogfood-output/screenshots/admin-hermes-task.png", fullPage: true });
  });

  test("integrations page shows Hermes readiness honestly", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/admin/integrations");
    const hermesCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Hermes Agent" }),
    });
    await expect(hermesCard).toBeVisible();
    await expect(hermesCard.getByText(/configured|missing|disabled/i).first()).toBeVisible();
    await page.screenshot({ path: "dogfood-output/screenshots/admin-integrations.png", fullPage: true });
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
    await loginAsAdmin(page);

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
