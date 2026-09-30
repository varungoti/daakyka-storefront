/** Read-only check that every visible category route contains product cards. */
import { draftCategories } from "../src/data/catalog/draft-catalog";

async function main() {
  const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
  const paths = [...new Set(draftCategories
    .filter((category) => category.showInMenu)
    .map((category) => `/category/${category.slug}`))].sort();

  const rows: Array<{ path: string; status: number; cards: number; ok: boolean }> = [];
  for (let offset = 0; offset < paths.length; offset += 6) {
    rows.push(...await Promise.all(paths.slice(offset, offset + 6).map(async (path) => {
      const response = await fetch(new URL(path, base), {
        signal: AbortSignal.timeout(15000),
      });
      const html = await response.text();
      const cards = (html.match(/href="\/products\//g) ?? []).length;
      return {
        path,
        status: response.status,
        cards,
        ok: response.status === 200 && cards > 0 && !html.includes("No products found"),
      };
    })));
  }

  const failures = rows.filter((row) => !row.ok);
  console.log(JSON.stringify({ base: base.origin, categoryLinks: paths.length, failures }, null, 2));
  if (paths.length < 20 || failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
