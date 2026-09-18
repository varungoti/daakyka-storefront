/**
 * Resolves a real, active product handle from the running server (same
 * approach tests/e2e/accessibility.spec.ts uses via /api/products) before
 * handing off to `lhci autorun`, so lighthouserc.js never has to guess a PDP
 * URL that might 404.
 *
 * Usage: npm run test:lighthouse
 *   (server must already be built and started at LHCI_BASE_URL)
 */
import { spawn } from "node:child_process";

const BASE = (process.env.LHCI_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

async function resolveProductHandle() {
  const res = await fetch(`${BASE}/api/products`);
  if (!res.ok) throw new Error(`GET /api/products -> ${res.status}`);
  const { products } = await res.json();
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("no products returned from /api/products");
  }
  const scrub = products.find((p) => /scrub/i.test(p.handle));
  return (scrub ?? products[0]).handle;
}

async function main() {
  const handle = await resolveProductHandle();
  console.log(`Lighthouse CI: using product handle "${handle}" from ${BASE}/api/products`);

  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["lhci", "autorun", "--config=lighthouserc.js"], {
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        LHCI_BASE_URL: BASE,
        LHCI_PRODUCT_HANDLE: handle,
      },
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`lhci autorun exit ${code}`))));
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
