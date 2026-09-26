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
