// Phase G Lighthouse CI gate. `preset: "lighthouse:no-pwa"` no longer exists
// in this Lighthouse version (12.x) — the PWA category was dropped from the
// default config entirely, so there is nothing left for a "no-pwa" preset to
// strip. We therefore just use the default config (mobile form-factor,
// simulated throttling) without an `extends`/`preset` override.
//
// The product URL is resolved dynamically by scripts/lighthouse-ci.mjs
// (same approach as tests/e2e/accessibility.spec.ts: ask /api/products for a
// real handle rather than hardcoding one) and passed in via
// LHCI_PRODUCT_HANDLE. The fallback below is a handle confirmed to exist and
// be active via `curl http://localhost:3000/api/products` during Phase G
// verification, in case that lookup ever fails.
const BASE_URL = process.env.LHCI_BASE_URL || "http://localhost:3000";
const PRODUCT_HANDLE = process.env.LHCI_PRODUCT_HANDLE || "mens-cargo-scrub-pants";

// See docs/PERFORMANCE.md for the measured baseline and why performance is
// gated below the master-plan target of 0.90 for now.
const PERFORMANCE_MIN_SCORE = 0.75;

module.exports = {
  ci: {
    collect: {
      url: [`${BASE_URL}/`, `${BASE_URL}/shop`, `${BASE_URL}/products/${PRODUCT_HANDLE}`],
      numberOfRuns: 1,
      settings: {
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 2.625,
          disabled: false,
        },
        throttlingMethod: "simulate",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: PERFORMANCE_MIN_SCORE }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./dogfood-output/lighthouse-ci",
    },
  },
};
