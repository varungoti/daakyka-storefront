/**
 * Vercel production build with resilient Prisma migrate (retries advisory lock timeouts).
 */
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

function run(command) {
  execSync(command, { stdio: "inherit", shell: true, env: process.env });
}

async function migrateWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run("npx prisma migrate deploy");
      return;
    } catch {
      if (attempt === maxAttempts) {
        console.error(`prisma migrate deploy failed after ${maxAttempts} attempts`);
        process.exit(1);
      }
      const waitMs = attempt * 8000;
      console.warn(
        `Migrate lock timeout (attempt ${attempt}/${maxAttempts}). Retrying in ${waitMs / 1000}s…`,
      );
      await sleep(waitMs);
    }
  }
}

async function main() {
  console.log("\n▶ prisma generate");
  run("npx prisma generate");

  console.log("\n▶ prisma migrate deploy (with retry)");
  await migrateWithRetry();

  console.log("\n▶ prisma seed");
  run("npx tsx prisma/seed.ts");

  console.log("\n▶ next build");
  run("npx next build");

  console.log("\n✓ Vercel build complete\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
