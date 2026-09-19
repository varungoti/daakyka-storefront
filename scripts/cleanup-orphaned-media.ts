import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultDb } from "@/lib/db";
import { deleteUnattachedMediaAsset, MediaAssetNotFoundError } from "@/lib/media/store";

/**
 * Release-hardening F-04 / plan item (docs/audit-2026-09-19/admin-ux.md):
 * sweeps up `MediaAsset` rows the new single-pass product-creation flow can
 * legitimately leave behind — see src/components/admin/staged-product-image-gallery.tsx
 * and src/lib/media/store.ts's `deleteUnattachedMediaAsset` doc comment for
 * the full picture.
 *
 * An admin can now upload or AI-generate a product photo *before* the
 * product itself is saved. That photo is a real `MediaAsset` (and a real R2
 * object) the moment it's created — not a browser-only draft — so if the
 * admin removes it from the staging gallery before saving, the UI deletes
 * it for real, right then (via `DELETE /api/admin/media/[id]`). But if the
 * admin instead abandons the form outright — closes the tab, force-quits,
 * navigates away and confirms "leave without saving" — there is no reliable
 * client-side moment to clean up after them (a page unload can't be trusted
 * to finish an async delete). This script is the backstop for exactly that
 * case: anything left with no `ProductImage`, no `Category`, and no
 * manifest `slot` pointing at it, past a grace period generous enough that
 * it can never catch an admin still actively mid-creation.
 *
 * This is a ONE-OFF, manually-run script — like scripts/cleanup-phantom-customers.ts,
 * it is not wired into any request path, cron, or `npm test`. Run it by hand:
 *
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-orphaned-media.ts            (dry run — reports only, deletes nothing)
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-orphaned-media.ts --execute  (actually deletes)
 *
 * or via the package.json alias: `npm run cleanup:orphaned-media -- [--execute]`.
 * An operator who wants this to run unattended can wire the npm script into
 * their own scheduler (cron, a hosting platform's scheduled job, etc.) —
 * deliberately not done here, matching how cleanup-phantom-customers.ts
 * leaves that choice to whoever operates the deployment.
 *
 * SAFETY:
 *  - Reads `DATABASE_URL` only (via src/lib/db.ts / createPrismaClient),
 *    exactly like the running app — never `SUPABASE_DATABASE_URL`.
 *    `assertNotProductionDatabase` below refuses to run at all if
 *    `DATABASE_URL` equals `SUPABASE_DATABASE_URL` or looks like a Supabase
 *    host, even though nothing in this file ever reads that variable for
 *    connecting (same belt-and-suspenders guard as the phantom-customer
 *    script, duplicated here rather than imported so this file stays a
 *    standalone, independently-runnable script like its sibling).
 *  - Defaults to a dry run. Deleting requires the explicit `--execute` flag.
 *  - Only ever deletes a MediaAsset that is unattached, un-slotted, and
 *    older than the grace period — see `isProvablyOrphaned` for the exact,
 *    conservative, independently-checked definition — and does so through
 *    `deleteUnattachedMediaAsset`, the same guarded function the admin
 *    UI's own delete route uses (so the "never delete anything in use"
 *    checks only ever live in one place).
 */

const DEFAULT_GRACE_PERIOD_HOURS = 48;

type Database = Pick<PrismaClient, "mediaAsset">;

export interface OrphanCandidate {
  id: string;
  key: string;
  usage: string;
  source: string;
  createdAt: Date;
  slot: string | null;
  productImageCount: number;
  categoryCount: number;
}

/** The DB-level filter for candidates: no slot, no ProductImage, no
 * Category, created before the cutoff. Exported so the shape of
 * "candidate" is visible/testable independent of a live DB. */
function candidateWhere(olderThan: Date) {
  return {
    slot: null,
    productImages: { none: {} },
    categories: { none: {} },
    createdAt: { lt: olderThan },
  } as const;
}

export async function findOrphanedMediaCandidates(
  database: Database = defaultDb,
  graceriodHours: number = DEFAULT_GRACE_PERIOD_HOURS,
): Promise<OrphanCandidate[]> {
  const olderThan = new Date(Date.now() - graceriodHours * 60 * 60 * 1000);

  const rows = await database.mediaAsset.findMany({
    where: candidateWhere(olderThan),
    select: {
      id: true,
      key: true,
      usage: true,
      source: true,
      createdAt: true,
      slot: true,
      _count: { select: { productImages: true, categories: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    usage: row.usage,
    source: row.source,
    createdAt: row.createdAt,
    slot: row.slot,
    productImageCount: row._count.productImages,
    categoryCount: row._count.categories,
  }));
}

/**
 * Defensive re-check of the exact same invariant `candidateWhere` filters
 * on, applied again in plain JS before anything is deleted — mirrors
 * `isProvablySynthetic` in cleanup-phantom-customers.ts. Pure and DB-free
 * (unit-testable without Postgres).
 */
export function isProvablyOrphaned(candidate: OrphanCandidate, gracePeriodHours: number = DEFAULT_GRACE_PERIOD_HOURS): boolean {
  const cutoff = Date.now() - gracePeriodHours * 60 * 60 * 1000;
  return (
    candidate.slot === null &&
    candidate.productImageCount === 0 &&
    candidate.categoryCount === 0 &&
    candidate.createdAt.getTime() < cutoff
  );
}

/** Refuses to proceed if `databaseUrl` is, or looks like, the production
 * Supabase database. Exported for direct unit testing. Identical logic to
 * cleanup-phantom-customers.ts's own guard — see the file-level comment
 * above for why it's duplicated rather than imported. */
export function assertNotProductionDatabase(databaseUrl: string | undefined, supabaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — refusing to run.");
  }
  if (supabaseUrl && databaseUrl === supabaseUrl) {
    throw new Error(
      "Refusing to run: DATABASE_URL is identical to SUPABASE_DATABASE_URL (production). " +
        "This script must only ever run against the local database.",
    );
  }
  if (/supabase\.co|pooler\.supabase\.com/i.test(databaseUrl)) {
    throw new Error(
      "Refusing to run: DATABASE_URL looks like a Supabase host (production). " +
        "This script must only ever run against the local database.",
    );
  }
}

export interface CliOptions {
  execute: boolean;
  graceHours: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const graceArg = argv.find((arg) => arg.startsWith("--older-than-hours="));
  const parsedGrace = graceArg ? Number(graceArg.slice("--older-than-hours=".length)) : NaN;
  return {
    execute: argv.includes("--execute"),
    graceHours: Number.isFinite(parsedGrace) && parsedGrace >= 0 ? parsedGrace : DEFAULT_GRACE_PERIOD_HOURS,
  };
}

function describeCandidate(c: OrphanCandidate): string {
  return `  - ${c.id}  key=${c.key}  usage=${c.usage}  source=${c.source}  createdAt=${c.createdAt.toISOString()}`;
}

export async function runCli(argv: string[], database: Database = defaultDb): Promise<number> {
  assertNotProductionDatabase(process.env.DATABASE_URL, process.env.SUPABASE_DATABASE_URL);
  const options = parseCliArgs(argv);

  const candidates = await findOrphanedMediaCandidates(database, options.graceHours);
  const safe = candidates.filter((c) => isProvablyOrphaned(c, options.graceHours));
  const suspicious = candidates.filter((c) => !isProvablyOrphaned(c, options.graceHours));

  console.log(
    `Scanned MediaAsset rows for orphans (no ProductImage, no Category, no manifest slot, ` +
      `older than ${options.graceHours}h — the F-04 staged-image create flow, docs/audit-2026-09-19/admin-ux.md).`,
  );
  console.log(`Found ${candidates.length} candidate(s).`);

  if (suspicious.length > 0) {
    // Should be unreachable given candidateWhere already enforces this — if
    // it ever happens, something about the query and the JS re-check have
    // drifted apart, and the safe move is to leave these rows alone and say
    // so loudly rather than guess.
    console.warn(`${suspicious.length} row(s) matched the DB query but failed the defensive re-check — NOT deleting these, please investigate:`);
    for (const c of suspicious) console.warn(describeCandidate(c));
  }

  if (safe.length === 0) {
    console.log("Nothing to clean up.");
    return 0;
  }

  console.log(`${safe.length} row(s) are provably orphaned and safe to delete:`);
  for (const c of safe) console.log(describeCandidate(c));

  if (!options.execute) {
    console.log(`\nDry run only (default) — ${safe.length} row(s) would be deleted. Re-run with --execute to actually delete them.`);
    return 0;
  }

  // Deletes go through deleteUnattachedMediaAsset (src/lib/media/store.ts)
  // one at a time — the same guarded, R2-then-DB function the admin UI's
  // own delete route uses — rather than a raw deleteMany, so the
  // "never delete anything in use" checks (and the real R2 object
  // removal) only ever live in one place.
  let deleted = 0;
  for (const candidate of safe) {
    try {
      await deleteUnattachedMediaAsset(candidate.id);
      deleted += 1;
    } catch (error) {
      if (error instanceof MediaAssetNotFoundError) {
        // Already gone (e.g. deleted by the admin UI between the scan
        // above and this loop) — not a failure worth stopping for.
        continue;
      }
      console.warn(`Failed to delete ${candidate.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\nDeleted ${deleted} orphaned media asset row(s).`);
  return 0;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await defaultDb.$disconnect();
    });
}
