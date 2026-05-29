/**
 * Probe a deployed storefront for launch readiness.
 *
 * Usage:
 *   TEST_BASE_URL=https://your-app.vercel.app npm run probe:deploy
 *   TEST_BASE_URL=https://your-app.vercel.app npm run probe:deploy -- --staging
 */
const base = process.env.TEST_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const isStaging = process.argv.includes("--staging");

if (!base) {
  console.error("Set TEST_BASE_URL to your deployment URL.");
  process.exit(1);
}

const errors = [];

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${message}`);
    console.error(`  FAIL ${label}: ${message}`);
  }
}

async function main() {
  console.log(`Probing ${base}${isStaging ? " (staging)" : ""}\n`);

  await check("GET /api/health", async () => {
    const response = await fetch(`${base}/api/health`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    if (body.status !== "ok") throw new Error(`status field ${body.status}`);
  });

  await check("security headers on /", async () => {
    const response = await fetch(`${base}/`);
    if (response.headers.get("x-frame-options") !== "DENY") {
      throw new Error("missing X-Frame-Options");
    }
    if (response.headers.get("x-content-type-options") !== "nosniff") {
      throw new Error("missing X-Content-Type-Options");
    }
  });

  await check("GET /sitemap.xml", async () => {
    const response = await fetch(`${base}/sitemap.xml`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const xml = await response.text();
    if (!xml.includes("/products/")) throw new Error("missing product URLs");
  });

  await check("GET /admin/login", async () => {
    const response = await fetch(`${base}/admin/login`);
    if (!response.ok) throw new Error(`status ${response.status}`);
  });

  await check("GET /api/admin/blog blocked without auth", async () => {
    const response = await fetch(`${base}/api/admin/blog`);
    if (response.status !== 401) {
      throw new Error(`expected 401, got ${response.status}`);
    }
  });

  await check("GET /shop", async () => {
    const response = await fetch(`${base}/shop`);
    if (!response.ok) throw new Error(`status ${response.status}`);
  });

  await check("GET /guides", async () => {
    const response = await fetch(`${base}/guides`);
    if (!response.ok) throw new Error(`status ${response.status}`);
  });

  await check("POST /api/auth/login rejects bad credentials", async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad@example.com", password: "wrong-password" }),
    });
    if (response.status !== 401) {
      throw new Error(`expected 401, got ${response.status}`);
    }
  });

  await check("GET /api/hermes/runtime/health", async () => {
    const response = await fetch(`${base}/api/hermes/runtime/health`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    if (!body.ok || body.service !== "daakyka-hermes") {
      throw new Error("unexpected Hermes health payload");
    }
  });

  await check("GET /mix-and-match/studio", async () => {
    const response = await fetch(`${base}/mix-and-match/studio`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const html = await response.text();
    if (html.includes("Studio unavailable")) {
      throw new Error("NEXT_PUBLIC_OUTFIT_STUDIO not enabled");
    }
    if (!html.includes("Virtual Try-On Studio")) {
      throw new Error("studio page missing expected heading");
    }
  });

  await check("POST /api/outfit/try-on responds", async () => {
    const topImageUrl =
      "https://images.unsplash.com/photo-1666887360684-8082fc98ebd2?auto=format&fit=crop&w=800&q=80";
    const response = await fetch(`${base}/api/outfit/try-on`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gender: "female",
        topImageUrl,
        color: "Navy",
      }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    if (!body.ok || typeof body.resultImageUrl !== "string") {
      throw new Error("missing resultImageUrl in try-on response");
    }
  });

  await check("WhatsApp FAB on homepage", async () => {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    if (!html.includes("wa.me")) throw new Error("missing WhatsApp FAB link");
    if (!html.includes("Chat on WhatsApp")) throw new Error("missing WhatsApp aria-label");
  });

  if (isStaging) {
    await check("robots.txt disallows indexing on staging", async () => {
      const response = await fetch(`${base}/robots.txt`);
      const text = await response.text();
      if (!/disallow:\s*\//i.test(text)) {
        throw new Error("robots.txt does not disallow /");
      }
    });
  }

  if (errors.length > 0) {
    console.error(`\nProbe failed (${errors.length} issue(s)):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log("\nDeploy probe passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
