/** Explicit operator-only database release; never a Vercel build step. */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function isLockTimeout(output) {
  return /P1002\b/.test(output) || /Timed out trying to acquire a lock/i.test(output);
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env */
export function releasePlan(argv, env = process.env) {
  const allowed = /^(--apply|--(target|expect-host|expect-database|expect-role)=.+)$/;
  const names = argv.map((arg) => arg.split("=")[0]);
  if (env.VERCEL || !argv.includes("--apply") || argv.some((arg) => !allowed.test(arg)) ||
      new Set(names).size !== names.length) {
    throw new Error("Operator-only: use --apply --target=production|staging --expect-host=HOST --expect-database=DB --expect-role=ROLE.");
  }
  const val = (prefix) => argv.find((arg) => arg.startsWith(prefix + "="))?.slice(prefix.length + 1);
  const target = val("--target");
  if (!["production", "staging"].includes(target)) throw new Error("Choose the reviewed production or staging database explicitly.");
  let url;
  try { url = new URL(env.MIGRATION_DATABASE_URL ?? ""); } catch { /* report without revealing URL */ }
  if (!url || !/^postgres(ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) ||
      ["host", "hostaddr", "user", "dbname", "port", "database", "options"].some((key) => url.searchParams.has(key)) ||
      url.hostname !== val("--expect-host") || decodeURIComponent(url.pathname.slice(1)) !== val("--expect-database") ||
      decodeURIComponent(url.username) !== val("--expect-role")) {
    throw new Error("MIGRATION_DATABASE_URL does not match the explicitly reviewed database host/name/role.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((target === "production" && loopback) || (!loopback && url.searchParams.get("sslmode") !== "verify-full")) {
    throw new Error("Production must not use loopback, and non-loopback releases require sslmode=verify-full.");
  }
  if (target === "production" && (!env.ADMIN_SEED_PASSWORD || env.ADMIN_SEED_PASSWORD.length < 12)) {
    throw new Error("A unique production ADMIN_SEED_PASSWORD is required before the database release.");
  }
  return { target, childEnv: { ...env, DATABASE_URL: url.href, MIGRATION_DATABASE_URL: url.href, VERCEL_ENV: target } };
}

function run(command, env, capture = false) {
  // Each command is a static string defined below; database URLs never go into shell arguments.
  const child = spawnSync(command, {
    shell: true, env, encoding: "utf8", stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  const output = capture ? (child.stdout ?? "") + (child.stderr ?? "") : "";
  if (output) process.stdout.write(output);
  return { ok: child.status === 0, output };
}

async function main() {
  const { target, childEnv } = releasePlan(process.argv.slice(2));
  if (!run("npx --no-install prisma generate", childEnv).ok) throw new Error("Prisma generation failed; no database mutation started.");
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = run("npx --no-install prisma migrate deploy", childEnv, true);
    if (result.ok) break;
    if (!isLockTimeout(result.output) || attempt === 5) throw new Error("Database migration failed; seed and image sync were not started.");
    await sleep(attempt * 8000);
  }
  if (!run("npx --no-install tsx prisma/seed.ts", childEnv).ok) throw new Error("Migration completed, but seed failed. Do not deploy until reviewed.");
  if (target === "production") {
    for (const command of ["npx --no-install tsx prisma/seed-kids-concepts.ts", "npx --no-install tsx scripts/sync-generated-product-images.ts --apply"]) {
      if (!run(command, childEnv).ok) throw new Error("Migration and base seed completed, but production catalogue preparation failed. Do not deploy until reviewed.");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof URIError ? "Malformed encoding in the explicitly selected database URL." : error.message);
    process.exitCode = 1;
  });
}
