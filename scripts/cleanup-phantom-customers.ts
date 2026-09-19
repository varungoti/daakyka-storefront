import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultDb } from "@/lib/db";

/**
 * Release-hardening F-01 / plan item 1.4 cleanup: removes already-created
 * "phantom" Customer rows — the kind guest checkout used to be able to
 * mint (random unusable password, fabricated email/phone, never linked to
 * the order that supposedly created it) before create-order.ts was fixed
 * to never do that (see src/lib/orders/create-order.ts and
 * src/lib/orders/claim-guest-orders.ts).
 *
 * This is a ONE-OFF, manually-run script — it is not wired into any
 * request path, cron, or `npm test`. Run it by hand:
 *
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-phantom-customers.ts            (dry run — reports only, deletes nothing)
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-phantom-customers.ts --execute   (actually deletes)
 *
 * or via the package.json alias: `npm run cleanup:phantom-customers -- [--execute]`.
 *
 * SAFETY:
 *  - Reads `DATABASE_URL` only (via src/lib/db.ts / createPrismaClient),
 *    exactly like the running app — never `SUPABASE_DATABASE_URL`. As an
 *    explicit extra guard (belt-and-suspenders, since a mistake here would
 *    be destructive), `assertNotProductionDatabase` below refuses to run
 *    at all if `DATABASE_URL` equals `SUPABASE_DATABASE_URL` or looks like
 *    a Supabase host, even though nothing in this file ever reads that
 *    variable for connecting.
 *  - Defaults to a dry run. Deleting requires the explicit `--execute` flag.
 *  - Only ever deletes a Customer row that is "provably synthetic" — see
 *    `isProvablySynthetic` below for the exact, conservative definition.
 *    A real registered account (even an inactive, unverified, or
 *    never-ordered one — e.g. someone who signed up and abandoned) is only
 *    ever matched if it also has zero addresses, zero reviews, and zero
 *    `CustomerToken` rows. Every real registration issues a VERIFY
 *    `CustomerToken` at signup time (see POST /api/account/register), so a
 *    row with zero tokens never went through that flow at all — it can
 *    only have been inserted directly, which is exactly the shape of the
 *    bug this cleans up.
 */

type Database = Pick<PrismaClient, "customer">;

export interface PhantomCandidate {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  createdAt: Date;
  orderCount: number;
  addressCount: number;
  reviewCount: number;
  tokenCount: number;
  wishlistCount: number;
}

/**
 * The DB-level filter for candidates: never verified, never attempted a
 * login (success or fail — `sessionVersion` only ever moves off 0 via a
 * password reset or an admin deactivate, see admin-customers.ts), and has
 * no order/address/review/token/wishlist row pointing at it. Exported so
 * the shape of "candidate" is visible/testable independent of a live DB.
 */
const PHANTOM_CANDIDATE_WHERE = {
  emailVerifiedAt: null,
  failedLoginCount: 0,
  lastFailedLoginAt: null,
  sessionVersion: 0,
  orders: { none: {} },
  addresses: { none: {} },
  reviews: { none: {} },
  tokens: { none: {} },
  wishlistItems: { none: {} },
} as const;

export async function findPhantomCustomerCandidates(database: Database = defaultDb): Promise<PhantomCandidate[]> {
  const rows = await database.customer.findMany({
    where: PHANTOM_CANDIDATE_WHERE,
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      createdAt: true,
      _count: { select: { orders: true, addresses: true, reviews: true, tokens: true, wishlistItems: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    createdAt: row.createdAt,
    orderCount: row._count.orders,
    addressCount: row._count.addresses,
    reviewCount: row._count.reviews,
    tokenCount: row._count.tokens,
    wishlistCount: row._count.wishlistItems,
  }));
}

/**
 * Defensive re-check of the exact same invariant `PHANTOM_CANDIDATE_WHERE`
 * filters on, applied again in plain JS before anything is deleted. Pure
 * and DB-free (unit-testable without Postgres) so a future accidental
 * loosening of the query above can't silently widen what this script is
 * willing to delete without also tripping this second check.
 */
export function isProvablySynthetic(candidate: PhantomCandidate): boolean {
  return (
    candidate.orderCount === 0 &&
    candidate.addressCount === 0 &&
    candidate.reviewCount === 0 &&
    candidate.tokenCount === 0 &&
    candidate.wishlistCount === 0
  );
}

/**
 * Refuses to proceed if `databaseUrl` is, or looks like, the production
 * Supabase database. Exported for direct unit testing.
 */
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
}

export function parseCliArgs(argv: string[]): CliOptions {
  return { execute: argv.includes("--execute") };
}

function describeCandidate(c: PhantomCandidate): string {
  return `  - ${c.id}  email=${c.email}  name="${c.name}"  phone=${c.phone ?? "—"}  createdAt=${c.createdAt.toISOString()}`;
}

export async function runCli(argv: string[], database: Database = defaultDb): Promise<number> {
  assertNotProductionDatabase(process.env.DATABASE_URL, process.env.SUPABASE_DATABASE_URL);
  const options = parseCliArgs(argv);

  const candidates = await findPhantomCustomerCandidates(database);
  const safe = candidates.filter(isProvablySynthetic);
  const suspicious = candidates.filter((c) => !isProvablySynthetic(c));

  console.log(
    `Scanned Customer rows for phantom checkout artifacts (never verified, never attempted a login, ` +
      `zero orders/addresses/reviews/tokens/wishlist items).`,
  );
  console.log(`Found ${candidates.length} candidate(s).`);

  if (suspicious.length > 0) {
    // Should be unreachable given PHANTOM_CANDIDATE_WHERE already enforces
    // this — if it ever happens, something about the query and the JS
    // re-check have drifted apart, and the safe move is to leave these
    // rows alone and say so loudly rather than guess.
    console.warn(
      `${suspicious.length} row(s) matched the DB query but failed the defensive re-check — NOT deleting these, please investigate:`,
    );
    for (const c of suspicious) console.warn(describeCandidate(c));
  }

  if (safe.length === 0) {
    console.log("Nothing to clean up.");
    return 0;
  }

  console.log(`${safe.length} row(s) are provably synthetic and safe to delete:`);
  for (const c of safe) console.log(describeCandidate(c));

  if (!options.execute) {
    console.log(`\nDry run only (default) — ${safe.length} row(s) would be deleted. Re-run with --execute to actually delete them.`);
    return 0;
  }

  const result = await database.customer.deleteMany({ where: { id: { in: safe.map((c) => c.id) } } });
  console.log(`\nDeleted ${result.count} phantom customer row(s).`);
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
