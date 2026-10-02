/**
 * Probe a deployed storefront for launch readiness.
 *
 * Safe against production by default: no check changes stored data (the one
 * POST, a login for an unknown email, is rejected before anything is written).
 * `--write-probes` adds the virtual try-on POST, which can call a paid
 * rendering service; use it only against a Preview/staging deployment
 * (F-076, F-077). While Mix & Match is switched off (the default) that route
 * answers 404 and the probe reports it as skipped, not failed (F-304).
 *
 * Usage:
 *   TEST_BASE_URL=https://your-app.vercel.app npm run probe:deploy
 *   TEST_BASE_URL=https://your-app.vercel.app npm run probe:deploy -- --staging
 *   TEST_BASE_URL=https://your-preview.vercel.app npm run probe:deploy -- --write-probes
 */
const base = process.env.TEST_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const isStaging = process.argv.includes("--staging");
const writeProbes = process.argv.includes("--write-probes");

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

  // The studio is an optional page an admin switches on (pages.mixMatch.enabled,
  // off by default), so a 404 is the correct state for a default install, not a
  // failed deploy. Only an enabled studio that renders the wrong page fails.
  await check("GET /mix-and-match/studio (optional page)", async () => {
    const response = await fetch(`${base}/mix-and-match/studio`);
    if (response.status === 404) {
      console.log("      studio is switched off (pages.mixMatch.enabled) - skipping its content check");
      return;
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    const html = await response.text();
    if (!html.includes("Virtual Try-On Studio")) {
      throw new Error("studio page missing expected heading");
    }
  });

  if (writeProbes) {
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
      // The route answers a JSON 404 while the optional Mix & Match feature is
      // switched off (pages.mixMatch.enabled, the default; F-304). That is the
      // correct state, not a failed deploy. An HTML 404 means the route itself is
      // missing from this build, which must still fail.
      if (response.status === 404) {
        const switchedOff = (response.headers.get("content-type") ?? "").includes("application/json");
        if (!switchedOff) throw new Error("status 404 (route missing from this deployment)");
        console.log("      try-on is switched off (pages.mixMatch.enabled) - skipping its response check");
        return;
      }
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = await response.json();
      if (!body.ok || typeof body.resultImageUrl !== "string") {
        throw new Error("missing resultImageUrl in try-on response");
      }
    });
  } else {
    console.log("  skip POST /api/outfit/try-on (write probe; pass --write-probes on a staging deployment)");
  }

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
      // Anchored to a bare `Disallow: /` line: `Disallow: /admin` alone
      // must not count as "indexing is blocked".
      if (!/^\s*disallow:\s*\/\s*$/im.test(text)) {
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
