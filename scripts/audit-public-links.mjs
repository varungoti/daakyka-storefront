/** Read-only crawl of sitemap pages and their rendered internal anchors. */
const base = new URL(process.argv[2] ?? "http://localhost:3000");
const timeoutMs = 12000;

function pathsFrom(text, pattern) {
  return [...text.matchAll(pattern)].map((match) =>
    match[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'"),
  );
}

async function get(path) {
  const url = new URL(path, base);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "DaakykaReleaseAudit/1.0" },
  });
  return { status: response.status, url: response.url, body: await response.text() };
}

async function mapLimited(items, limit, fn) {
  const results = Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        results[index] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  }));
  return results;
}

const sitemap = await get("/sitemap.xml");
if (sitemap.status !== 200) throw new Error(`sitemap.xml returned ${sitemap.status}`);
const sitemapPaths = [...new Set(pathsFrom(sitemap.body, /<loc>([^<]+)<\/loc>/g)
  .map((url) => new URL(url).pathname))];

const pages = await mapLimited(sitemapPaths, 6, async (path) => {
  const result = await get(path);
  const links = pathsFrom(result.body, /<a\b[^>]*\bhref="([^"]+)"/g);
  const images = pathsFrom(result.body, /<img\b[^>]*\bsrc="([^"]+)"/g);
  return { path, status: result.status, links, images };
});

const targets = new Map();
const imageTargets = new Map();
for (const page of pages) {
  if (!page.links) continue;
  for (const href of page.links) {
    let target;
    try { target = new URL(href, new URL(page.path, base)); } catch { continue; }
    if (target.origin !== base.origin || target.pathname.startsWith("/api/")) continue;
    const path = target.pathname + target.search;
    if (!targets.has(path)) targets.set(path, []);
    targets.get(path).push(page.path);
  }
  for (const src of page.images) {
    if (src.startsWith("data:")) continue;
    let target;
    try { target = new URL(src, new URL(page.path, base)); } catch { continue; }
    if (!imageTargets.has(target.href)) imageTargets.set(target.href, []);
    imageTargets.get(target.href).push(page.path);
  }
}

const linkChecks = await mapLimited([...targets.keys()], 6, async (path) => {
  const result = await get(path);
  return { path, status: result.status, sources: targets.get(path) };
});
const imageChecks = await mapLimited([...imageTargets.keys()], 6, async (url) => {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
  return { url, status: response.status, sources: imageTargets.get(url) };
});
const failures = [
  ...pages.filter((page) => page.error || page.status !== 200).map(({ path, status, error }) => ({ path, status, error, kind: "sitemap" })),
  ...linkChecks.filter((link) => link.error || link.status >= 400).map((link) => ({ ...link, kind: "anchor" })),
  ...imageChecks.filter((image) => image.error || image.status >= 400).map((image) => ({ ...image, kind: "image" })),
];
console.log(JSON.stringify({ base: base.origin, sitemapPages: sitemapPaths.length, anchorTargets: targets.size, imageTargets: imageTargets.size, failures }, null, 2));
if (failures.length) process.exitCode = 1;
