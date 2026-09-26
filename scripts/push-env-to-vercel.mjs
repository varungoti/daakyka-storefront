/**
 * Push the local .env values this app needs into Vercel Production.
 *
 * Why this exists: the production variable names don't all match the local
 * ones. `DATABASE_URL` locally points at the Docker Postgres used for tests,
 * while production needs the Supabase session-pooler string that lives under
 * `SUPABASE_DATABASE_URL`; the R2 credentials may be stored under their
 * `CLOUDFLARE_*` names. Copying by hand gets that mapping wrong in exactly
 * the way that silently boots production against the wrong database.
 *
 * `computePlan()` (the mapping + validation) is exported so
 * `scripts/go-live.mjs`'s own preflight can run the exact same checks
 * before anything leaves the machine, instead of only discovering a
 * mapping problem after it has already started writing to Vercel (F-346).
 *
 * Usage:
 *   node scripts/push-env-to-vercel.mjs            # dry run: show the plan
 *   node scripts/push-env-to-vercel.mjs --apply    # actually write to Vercel
 *
 * Values are streamed to `vercel env add` over stdin and are never printed,
 * logged, or written anywhere by this script.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readEnvFile } from "./lib/read-env-file.mjs";
import { isLikelyProtectedVercelAlias } from "./lib/deploy-checks.mjs";

export const TARGET = "production";

/**
 * production var name -> local .env candidate name(s) it is sourced from,
 * in preference order. The R2/Cloudflare candidate order mirrors
 * src/lib/storage/r2.ts's readR2Env() fallback exactly, so this script and
 * the app itself can never disagree about which value wins (F-346).
 *
 * `optional: true` means: only a problem if the value is present and
 * invalid, never merely because it's absent — OPENAI_API_KEY and the R2
 * trio all degrade to a clean "not configured" at runtime (see
 * src/lib/ai/image-generation.ts, src/lib/storage/r2.ts), so a go-live
 * with none of them set is not a mapping problem.
 *
 * NEXT_PUBLIC_ALLOW_INDEXING is deliberately NOT in this mapping and never
 * should be: it's an operator-set kill switch (src/lib/env.ts's
 * isIndexingAllowed), and this script pushing or overwriting it as a side
 * effect of an unrelated go-live is exactly how it gets left on
 * Production by accident (F-349). scripts/go-live.mjs checks for an
 * existing one on Vercel before pushing anything, instead.
 */
export const MAPPING = [
  { prod: "DATABASE_URL", from: ["SUPABASE_DATABASE_URL"] },
  { prod: "ADMIN_SEED_PASSWORD", from: ["ADMIN_SEED_PASSWORD"] },
  { prod: "CREDENTIAL_ENCRYPTION_KEY", from: ["CREDENTIAL_ENCRYPTION_KEY"] },
  { prod: "NEXT_PUBLIC_SITE_URL", from: ["NEXT_PUBLIC_SITE_URL"] },
  { prod: "OPENAI_API_KEY", from: ["OPENAI_API_KEY"], optional: true },
  { prod: "R2_ACCOUNT_ID", from: ["R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"], optional: true },
  {
    prod: "R2_ACCESS_KEY_ID",
    from: ["R2_ACCESS_KEY_ID", "CLOUDFLARE_ACCESS_KEY_ID", "CLOUDFLARE_ACCESS_KEY"],
    optional: true,
  },
  {
    prod: "R2_SECRET_ACCESS_KEY",
    from: ["R2_SECRET_ACCESS_KEY", "CLOUDFLARE_SECRET_ACCESS_KEY"],
    optional: true,
  },
];

// F-301: these project's real, once-published SUPER_ADMIN/VIEWER seed
// defaults are deny-listed by SHA-256 digest, not by value, so the leaked
// plaintext is never reintroduced here. See src/lib/auth/seed-defaults.ts.
const LEAKED_SEED_PASSWORD_DIGESTS = new Set([
  "c60122eef0f379572315898a19084a6b36ff05333fc6adf0c648e9777f5e6adb",
  "1c7da5b5e8f47830852c97475be97424745f5ffe6bb2e04e5736bb8a6ab2233e",
]);

/** Sanity checks that would otherwise only surface as a failed build. */
function validate(prod, value) {
  if (prod === "ADMIN_SEED_PASSWORD") {
    const blocked = new Set(["password", "changeme", "admin", "admin123"]);
    if (value.length < 12) return `too short (${value.length} chars, needs >= 12)`;
    if (blocked.has(value)) return "matches a known default password";
    if (LEAKED_SEED_PASSWORD_DIGESTS.has(createHash("sha256").update(value, "utf8").digest("hex")))
      return "matches a known leaked/default password";
  }
  if (prod === "DATABASE_URL") {
    if (!value.startsWith("postgres")) return "is not a postgres:// URL";
    if (value.includes("localhost")) return "points at localhost, not Supabase";
  }
  if (prod === "CREDENTIAL_ENCRYPTION_KEY") {
    const bytes = /^[0-9a-fA-F]{64}$/.test(value)
      ? Buffer.from(value, "hex").length
      : Buffer.from(value, "base64").length;
    if (bytes !== 32) return `decodes to ${bytes} bytes, needs exactly 32`;
  }
  if (prod === "NEXT_PUBLIC_SITE_URL") {
    if (!value.startsWith("https://")) return "must be an https:// URL";
    if (isLikelyProtectedVercelAlias(value))
      return "looks like an SSO-protected Vercel alias (ends in -projects.vercel.app) — see F-007";
  }
  // F-347: a quoted value followed by an inline comment used to leave
  // literal quote characters in the value pushed to Vercel. That parser
  // bug is fixed (see read-env-file.mjs), but this catches any value that
  // still somehow carries a quote character — a stray unbalanced quote in
  // .env, for instance — before it silently breaks whatever reads the
  // pushed secret back out.
  if ((prod === "OPENAI_API_KEY" || prod.startsWith("R2_")) && /["']/.test(value)) {
    return "contains a quote character — check how .env quotes this value (see F-347)";
  }
  return null;
}

/**
 * Pure: resolves `MAPPING` against an already-parsed .env (a Map, as
 * `readEnvFile()` returns), trying each candidate source name in order.
 * Returns `{ plan, problems }` — `plan` is what would be pushed, in the
 * same shape the apply loop below consumes; `problems` is every reason a
 * mapping entry can't be pushed as-is. Never touches the network.
 */
export function computePlan(env) {
  const plan = [];
  const problems = [];

  for (const entry of MAPPING) {
    let value;
    let from;
    for (const candidate of entry.from) {
      const candidateValue = env.get(candidate);
      if (candidateValue) {
        value = candidateValue;
        from = candidate;
        break;
      }
    }
    if (!value) {
      if (!entry.optional) {
        problems.push(`${entry.prod}: source ${entry.from.join(" / ")} is missing from .env`);
      }
      continue;
    }
    const bad = validate(entry.prod, value);
    if (bad) {
      problems.push(`${entry.prod}: ${bad}`);
      continue;
    }
    plan.push({ prod: entry.prod, from, value });
  }

  return { plan, problems };
}

function main() {
  const APPLY = process.argv.includes("--apply");

  let env;
  try {
    env = readEnvFile(".env");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { plan, problems } = computePlan(env);

  console.log(`Plan for Vercel ${TARGET}:\n`);
  for (const item of plan) {
    console.log(`  push     ${item.prod.padEnd(26)} (from ${item.from}, ${item.value.length} chars)`);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) — these will NOT be pushed:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these to Vercel.");
    process.exit(problems.length > 0 ? 1 : 0);
  }

  if (problems.length > 0) {
    // F-346: fail closed. Applying the ones that DID pass validation while
    // silently skipping the ones that didn't is exactly how Vercel ended
    // up half-written before (F-345) — an operator fixing the reported
    // problem(s) and re-running always gets a clean, complete push instead.
    console.error("\nRefusing to write anything to Vercel while the problem(s) above remain.");
    process.exit(1);
  }

  if (plan.length === 0) {
    console.error("\nNothing to push.");
    process.exit(1);
  }

  console.log("");
  let failed = 0;

  for (const item of plan) {
    // F-345: always --force (Vercel's upsert). A separate `env rm` + plain
    // `env add` failed outright with ENV_ALREADY_EXISTS/ENV_CONFLICT on
    // every re-run once Vercel already had the name from a previous push —
    // which, for every variable except the one `rm`'d first, was every run
    // after the very first successful one, with no way to recover short of
    // deleting the variable by hand first.
    const result = spawnSync("npx", ["vercel", "env", "add", item.prod, TARGET, "--force"], {
      input: item.value,
      stdio: ["pipe", "ignore", "pipe"],
      shell: true,
    });
    const ok = result.status === 0;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${item.prod}`);
    if (!ok && result.stderr) {
      // stderr from `vercel env add` echoes only the variable name, not the value.
      console.log(`        ${String(result.stderr).trim().split("\n").slice(-2).join(" ")}`);
    }
  }

  console.log(
    failed === 0
      ? `\nDone. Verify with: npx vercel env ls ${TARGET}`
      : `\n${failed} variable(s) failed — see above. Every entry uses --force, so fixing the ` +
          "underlying problem and re-running always overwrites cleanly; nothing needs manual cleanup first.",
  );
  process.exit(failed === 0 ? 0 : 1);
}

// Only run the CLI when this file is executed directly (`node
// scripts/push-env-to-vercel.mjs`) — not when scripts/go-live.mjs or this
// module's own tests import `computePlan`/`MAPPING` from it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
