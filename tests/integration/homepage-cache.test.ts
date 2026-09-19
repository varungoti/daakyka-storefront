import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { getTrustStatsContent, updateHomepageSection } from "@/lib/homepage";
import { PUT as putHomepageSection } from "@/app/api/admin/homepage/[key]/route";

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

/**
 * Covers the P0 fix: an admin's homepage-section edit reaching the live
 * site. src/app/page.tsx ("/") is fully static, so getTrustStatsContent()
 * must be cache-tagged and updateHomepageSection() must revalidate that
 * tag — see src/lib/homepage/index.ts. The revalidateHomepageCache()
 * injection contract itself (exact tag + profile passed to revalidateTag)
 * is unit-tested in src/lib/homepage/index.test.ts, since next/cache's
 * real exports can't be spied on (non-configurable accessor properties).
 * This test covers the other half: the actual DB write is visible through
 * the exact getter src/app/page.tsx calls. Outside a real Next.js server
 * unstable_cache always throws (no static generation store), so this
 * exercises getTrustStatsContent()'s uncached fallback path rather than a
 * real cache hit — that's expected and matches every other cached getter
 * in this codebase when run under `tsx --test` (see
 * src/lib/settings/index.ts's getSetting() and
 * tests/integration/site-settings.test.ts).
 */
describe("homepage section cache round trip", () => {
  let adminId: string;
  let original: { content: string; enabled: boolean } | null = null;

  before(async () => {
    adminId = await findAnyAdminId();
    const existing = await db.homepageSection.findUnique({ where: { key: "trust-stats" } });
    if (existing) {
      original = { content: existing.content, enabled: existing.enabled };
    } else {
      await db.homepageSection.create({
        data: { key: "trust-stats", title: "Trust Stats", content: JSON.stringify({ stats: [] }) },
      });
    }
  });

  after(async () => {
    if (original) {
      await db.homepageSection.update({
        where: { key: "trust-stats" },
        data: { content: original.content, enabled: original.enabled },
      });
    } else {
      await db.homepageSection.delete({ where: { key: "trust-stats" } }).catch(() => {});
    }
  });

  it("updateHomepageSection's write is visible through getTrustStatsContent(), and is audit-logged", async () => {
    const marker = `Integration Test ${Date.now()}`;
    const newContent = { stats: [{ value: "1", label: marker }] };

    await updateHomepageSection("trust-stats", newContent, adminId);

    const read = await getTrustStatsContent();
    assert.deepEqual(read, newContent);

    const audit = await db.auditLog.findFirst({
      where: { entity: "homepage_section", entityId: "trust-stats" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit, "expected an audit log row for the homepage section change");
    assert.equal(audit.action, "update");
  });
});

/**
 * Release-hardening F-5: PUT /api/admin/homepage/[key] used to pass the
 * raw request body straight into updateHomepageSection() with zero schema
 * validation (see src/app/api/admin/homepage/[key]/route.ts and the new
 * heroContentSchema / announcementContentSchema / trustStatsContentSchema
 * in src/lib/validation/schemas.ts, unit-tested directly in
 * src/lib/validation/schemas.test.ts). getSession() needs a real Next.js
 * request scope for cookies() (see src/lib/auth/session.ts), which this
 * `tsx --test` harness doesn't provide when calling a route handler
 * directly — so, matching every other admin-route integration test in this
 * repo (e.g. tests/integration/site-settings.test.ts,
 * tests/integration/admin-crud-completion.test.ts), this only exercises
 * the auth gate and the fact that it runs before any key/body validation.
 * The Zod schemas themselves, and isHomepageSectionKey(), are fully
 * unit-tested without needing a session at all.
 */
describe("PUT /api/admin/homepage/[key]", () => {
  it("rejects with 401/403 when called with no session, for a known key", async () => {
    const request = new Request("http://localhost/api/admin/homepage/hero", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    const response = await putHomepageSection(request, { params: Promise.resolve({ key: "hero" }) });
    assert.ok([401, 403].includes(response.status), `expected 401 or 403, got ${response.status}`);
  });

  it("still rejects unauthenticated even for an unknown key (auth checked before the key is validated)", async () => {
    const request = new Request("http://localhost/api/admin/homepage/not-a-real-section", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });
    const response = await putHomepageSection(request, {
      params: Promise.resolve({ key: "not-a-real-section" }),
    });
    assert.ok([401, 403].includes(response.status), `expected 401 or 403, got ${response.status}`);
  });
});
