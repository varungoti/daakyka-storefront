import { test, expect } from "@playwright/test";

import {
  DEFAULT_ADMIN_SEED_EMAIL,
  DEFAULT_ADMIN_SEED_PASSWORD,
  DEFAULT_VIEWER_SEED_EMAIL,
  DEFAULT_VIEWER_SEED_PASSWORD,
} from "@/lib/auth/seed-defaults";

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? DEFAULT_ADMIN_SEED_PASSWORD;
const VIEWER_EMAIL = process.env.VIEWER_SEED_EMAIL ?? DEFAULT_VIEWER_SEED_EMAIL;
const VIEWER_PASSWORD = process.env.VIEWER_SEED_PASSWORD ?? DEFAULT_VIEWER_SEED_PASSWORD;

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15000 });
}

test.describe("Admin E2E", () => {
  test("login and reach dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  });

  test("unauthenticated admin redirects to login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("reports and SEO manager load after login", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/admin/reports");
    await expect(page.getByRole("heading", { name: /Weekly Growth Report/i })).toBeVisible();

    await page.goto("/admin/seo");
    await expect(page.getByRole("heading", { name: /SEO Manager/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Schema Validation/i })).toBeVisible();

    await page.goto("/admin/journeys");
    await expect(page.getByRole("heading", { name: /Customer Journeys/i })).toBeVisible();

    await page.goto("/admin/reputation");
    await expect(page.getByRole("heading", { name: /Review & Reputation/i })).toBeVisible();
  });

  test("homepage CMS saves hero copy", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/homepage");
    await expect(page.getByRole("heading", { name: /Homepage Manager/i })).toBeVisible();

    const headline = page.getByLabel("Headline", { exact: true });
    const unique = `E2E Hero ${Date.now()}`;
    await headline.fill(unique);
    await page.getByRole("button", { name: /save hero/i }).click();
    await expect(page.getByText("Saved successfully")).toBeVisible({ timeout: 10000 });
  });

  test("blog draft create flow", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/blog/new");
    const slug = `e2e-draft-${Date.now()}`;
    await page.getByLabel("Title").fill(`E2E Draft ${slug}`);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("Excerpt").fill("Automated E2E draft post excerpt for QA.");
    await page
      .getByLabel("Image URL")
      .fill(
        "https://images.pexels.com/photos/4173251/pexels-photo-4173251.jpeg?auto=compress&cs=tinysrgb&w=800&fit=crop",
      );
    await page.getByLabel("Content Paragraphs").fill("First paragraph of E2E test content.");
    await page.getByRole("button", { name: /save article/i }).click();
    await expect(page).toHaveURL(/\/admin\/blog/, { timeout: 15000 });
    await expect(page.getByText(`E2E Draft ${slug}`)).toBeVisible();
  });

  test("Hermes task creates approval queue entry", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/hermes");
    await expect(page.getByRole("heading", { name: /Hermes Agent/i })).toBeVisible();

    await page.getByRole("button", { name: /daily seo health scan/i }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeHidden({ timeout: 30000 });
    await expect(
      page.locator("text=/Pending Approvals|daily.seo|Approval Queue/i").first(),
    ).toBeVisible({ timeout: 15000 });
    const pending = page.locator("section").filter({ hasText: "Approval Queue" });
    await expect(pending.getByText(/Hermes|daily|seo|PENDING/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("VIEWER role cannot access blog CMS or users API", async ({ page, request }) => {
    await page.context().clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(VIEWER_EMAIL);
    await page.getByLabel(/password/i).fill(VIEWER_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15000 });

    await page.goto("/admin/blog");
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    const blogApi = await page.request.get("/api/admin/blog");
    expect(blogApi.status()).toBe(403);
  });
});
