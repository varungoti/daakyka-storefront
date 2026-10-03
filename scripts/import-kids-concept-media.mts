/**
 * Authenticated, resumable import of locally reviewed ChatGPT Images views
 * through the store's own admin upload API (which stores them in R2).
 * Nothing is published; all 20 targets must remain zero-price DRAFTs.
 *
 * Usage: npx tsx scripts/import-kids-concept-media.mts --execute
 *   --email <configured admin email> --password-file <temporary secret path>
 *   --permanent-password-file <new secret path> --manifest <ignored path>
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { kidsConcepts } from "../src/data/catalog/kids-concepts";

type View = { slug: string; view: string; file: string; sha256: string; alt: string; prompt: string };
type Receipt = Record<string, { assetId: string; attached: boolean }>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const manifestPath = arg("--manifest") ?? "dogfood-output/kids-concepts/view-manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as View[];
const conceptBySlug = new Map(kidsConcepts.map((concept) => [concept.slug, concept]));
if (manifest.length !== 60 || new Set(manifest.map((row) => row.slug)).size !== 20) {
  throw new Error("Expected exactly 60 views across 20 concepts");
}
for (const row of manifest) {
  if (!conceptBySlug.has(row.slug) || !["front", "back", "detail"].includes(row.view)) {
    throw new Error(`Unexpected concept view ${row.slug}/${row.view}`);
  }
  const bytes = await readFile(row.file);
  if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
    throw new Error(`Concept image hash mismatch: ${row.slug}/${row.view}`);
  }
}
if (!process.argv.includes("--execute")) {
  console.log("Dry run: 20 concept drafts and 60 hash-verified AI views ready for authenticated R2 import.");
  process.exit(0);
}

const passwordFile = arg("--password-file");
const permanentPasswordFile = arg("--permanent-password-file");
const email = arg("--email")?.trim().toLowerCase();
if (!passwordFile || !permanentPasswordFile || !email) throw new Error("Admin email and both password files are required for import");
const password = (await readFile(passwordFile, "utf8")).trim();
const permanentPassword = (await readFile(permanentPasswordFile, "utf8")).trim();
if (permanentPassword.length < 20 || permanentPassword === password) throw new Error("A distinct strong permanent password is required");
const origin = new URL(arg("--base") ?? "https://storefront-nu-woad.vercel.app");
if (origin.protocol !== "https:" || origin.hostname !== "storefront-nu-woad.vercel.app") {
  throw new Error("Import is restricted to the verified DAAKYKA production alias");
}

async function loginWith(secret: string) {
  return fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: secret }),
  });
}
let login = await loginWith(password);
let usedTemporaryPassword = login.status === 200;
if (login.status !== 200) {
  login = await loginWith(permanentPassword);
  usedTemporaryPassword = false;
}
if (login.status !== 200) throw new Error(`Admin login for media import failed: HTTP ${login.status}`);
let cookie: string = login.headers.get("set-cookie")?.split(";")[0] ?? "";
if (!cookie) throw new Error("Admin login did not issue a session cookie");

async function request(url: string, options: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(new URL(url, origin), {
      ...options,
      headers: { ...(options.headers as Record<string, string> | undefined), cookie },
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status !== 429) return response;
    const waitSeconds = Math.min(75, Math.max(2, Number(response.headers.get("retry-after")) || 60));
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
  throw new Error(`Rate limit did not clear for ${url}`);
}

if (usedTemporaryPassword) {
  const probe = await request("/api/admin/products?search=kids-raglan-play-tee&pageSize=1");
  if (probe.status === 423) {
    const rotated = await request("/api/admin/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: password, newPassword: permanentPassword }),
    });
    if (rotated.status !== 200) throw new Error(`Admin password rotation failed: HTTP ${rotated.status}`);
    cookie = rotated.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie) throw new Error("Password rotation did not issue a fresh session cookie");
    console.log("Recovered admin password rotated; old sessions and temporary credential revoked.");
  } else if (!probe.ok) {
    throw new Error(`Admin access probe failed: HTTP ${probe.status}`);
  }
}

const receiptPath = path.resolve(path.dirname(manifestPath), "import-receipt.json");
let receipt: Receipt = {};
try { receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Receipt; } catch { /* first run */ }
const saveReceipt = () => writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

for (const concept of kidsConcepts) {
  const list = await request(`/api/admin/products?search=${encodeURIComponent(concept.slug)}&pageSize=25`);
  if (!list.ok) throw new Error(`Catalog lookup failed for ${concept.slug}: HTTP ${list.status}`);
  const items = ((await list.json()) as { items: { id: string; slug: string }[] }).items;
  const listed = items.find((item) => item.slug === concept.slug);
  if (!listed) throw new Error(`Concept draft missing from production: ${concept.slug}`);
  const detail = await request(`/api/admin/products/${listed.id}`);
  if (!detail.ok) throw new Error(`Detail lookup failed for ${concept.slug}: HTTP ${detail.status}`);
  const product = ((await detail.json()) as { product: { status: string; price: number; images: { alt: string | null }[] } }).product;
  if (product.status !== "DRAFT" || product.price !== 0) {
    throw new Error(`Refusing media import because ${concept.slug} is purchasable or priced`);
  }
  for (const view of manifest.filter((row) => row.slug === concept.slug)) {
    const key = `${view.slug}/${view.view}`;
    if (product.images.some((image) => image.alt === view.alt)) {
      receipt[key] = { assetId: receipt[key]?.assetId ?? "attached", attached: true };
      await saveReceipt();
      continue;
    }
    let assetId = receipt[key]?.assetId;
    if (!assetId || assetId === "attached") {
      const form = new FormData();
      const bytes = await readFile(view.file);
      form.set("file", new Blob([bytes], { type: "image/webp" }), path.basename(view.file));
      form.set("usage", "PRODUCT");
      form.set("alt", view.alt);
      form.set("aiPrompt", `${view.prompt}; ${concept.design}`);
      const upload = await request("/api/admin/media", { method: "POST", body: form });
      if (upload.status !== 201) throw new Error(`R2 upload failed for ${key}: HTTP ${upload.status}`);
      assetId = ((await upload.json()) as { asset: { id: string } }).asset.id;
      receipt[key] = { assetId, attached: false };
      await saveReceipt();
    }
    const attached = await request(`/api/admin/products/${listed.id}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaAssetId: assetId, color: concept.color, alt: view.alt }),
    });
    if (attached.status !== 201) throw new Error(`Gallery attachment failed for ${key}: HTTP ${attached.status}`);
    receipt[key] = { assetId, attached: true };
    await saveReceipt();
    console.log(`Attached ${key}`);
  }
}
console.log("R2 media import complete: 60 AI-marked gallery views attached to 20 non-purchasable drafts.");
