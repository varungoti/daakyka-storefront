import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../../next.config";

/**
 * F-119: the CSP shipped from next.config.ts was blocking Razorpay's own
 * risk-detection script (cdn.razorpay.com) and telemetry beacon
 * (lumberjack.razorpay.com) that checkout.js loads once it opens — payments
 * still worked, but Razorpay's fraud/risk scoring was silently disabled on
 * every checkout. This asserts the real header the app serves (via
 * next.config.ts's headers()), not a hand-copied string, so it breaks if
 * the directive ever regresses.
 */
async function getCspHeaderValue(): Promise<string> {
  const headerGroups = await nextConfig.headers?.();
  assert.ok(
    headerGroups && headerGroups.length > 0,
    "expected next.config.ts's headers() to return at least one group",
  );
  const group = headerGroups![0];
  const cspHeader = group.headers.find((header) => header.key === "Content-Security-Policy");
  assert.ok(cspHeader, "expected a Content-Security-Policy header in next.config.ts's headers()");
  return cspHeader!.value;
}

function directive(csp: string, name: string): string {
  const match = csp.match(new RegExp(`(?:^|; )${name} ([^;]*)`));
  assert.ok(match, `expected a ${name} directive in the CSP`);
  return match![1];
}

describe("Content-Security-Policy — Razorpay checkout script & telemetry (F-119)", () => {
  it("allows checkout.js and its risk-detection bundle in script-src", async () => {
    const csp = await getCspHeaderValue();
    const scriptSrc = directive(csp, "script-src");
    assert.ok(
      scriptSrc.includes("https://checkout.razorpay.com"),
      "script-src must still allow https://checkout.razorpay.com (the Checkout.js loader)",
    );
    assert.ok(
      scriptSrc.includes("https://cdn.razorpay.com"),
      "script-src must allow https://cdn.razorpay.com (razorpay-risk-detection/bundle.js), " +
        "otherwise the browser refuses it with a script-src-elem violation",
    );
  });

  it("allows Razorpay's API iframe and its risk telemetry beacon in connect-src", async () => {
    const csp = await getCspHeaderValue();
    const connectSrc = directive(csp, "connect-src");
    assert.ok(
      connectSrc.includes("https://api.razorpay.com"),
      "connect-src must still allow https://api.razorpay.com",
    );
    assert.ok(
      connectSrc.includes("https://lumberjack.razorpay.com"),
      "connect-src must allow https://lumberjack.razorpay.com, otherwise the risk-detection " +
        "script's telemetry (fetch/XHR to /v1/track, sendBeacon to /v2/logz) is refused",
    );
  });

  it("keeps the Razorpay iframe host in frame-src and does not widen frame-src to cdn/lumberjack", async () => {
    const csp = await getCspHeaderValue();
    const frameSrc = directive(csp, "frame-src");
    assert.ok(frameSrc.includes("https://api.razorpay.com"));
    assert.ok(frameSrc.includes("https://checkout.razorpay.com"));
    assert.ok(
      !frameSrc.includes("cdn.razorpay.com") && !frameSrc.includes("lumberjack.razorpay.com"),
      "the risk-detection script and telemetry host are not iframe sources — keep frame-src tight",
    );
  });
});

/**
 * F-221 / F-307: the framework fingerprint header is off, /cdn media gets its
 * own locked-down policy, and the image optimizer / CSP no longer trust the
 * Shopify CDN. script-src keeps 'unsafe-inline' on purpose (nonces would force
 * every page to render dynamically; see the comment in next.config.ts).
 */
describe("next.config.ts header hardening (F-221, F-307)", () => {
  it("does not send X-Powered-By", () => {
    assert.equal(nextConfig.poweredByHeader, false);
  });

  it("gives /cdn responses a policy that allows nothing, after the catch-all so it wins", async () => {
    const groups = (await nextConfig.headers?.()) ?? [];
    assert.equal(groups[0].source, "/(.*)", "the global policy must stay first (a later rule overrides an earlier one)");
    const cdnIndex = groups.findIndex((group) => group.source === "/cdn/:path*");
    assert.ok(cdnIndex > 0, "expected a /cdn/:path* header group after the catch-all");
    const csp = groups[cdnIndex].headers.find((header) => header.key === "Content-Security-Policy");
    assert.ok(csp);
    assert.match(csp!.value, /default-src 'none'/);
    assert.match(csp!.value, /sandbox/);
    assert.ok(!csp!.value.includes("script-src"));
  });

  it("does not trust cdn.shopify.com for images, in remotePatterns or in img-src", async () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];
    assert.ok(!patterns.some((pattern) => "hostname" in pattern && pattern.hostname === "cdn.shopify.com"));
    const csp = await getCspHeaderValue();
    assert.ok(!directive(csp, "img-src").includes("cdn.shopify.com"));
  });
});
