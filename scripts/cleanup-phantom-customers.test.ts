import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  assertNotProductionDatabase,
  findPhantomCustomerCandidates,
  isProvablySynthetic,
  parseCliArgs,
  runCli,
  type PhantomCandidate,
} from "./cleanup-phantom-customers";

/**
 * Release-hardening F-01 / plan item 1.4: tests for the phantom-customer
 * cleanup script. The DB-touching tests below never call the unscoped
 * `findPhantomCustomerCandidates()`/`runCli()` against the whole shared
 * dev database (other integration test files run against the same
 * Postgres instance and may transiently create rows that would also match
 * the phantom criteria between their own setup steps) — instead they pass
 * a `scopedDb` wrapper that constrains every query this script issues to
 * exactly the customer ids this test created, so the *real* Prisma query
 * (PHANTOM_CANDIDATE_WHERE's relation filters, `_count`, `deleteMany`) is
 * still exercised end-to-end, just never outside this test's own rows.
 */

type Database = Pick<PrismaClient, "customer">;

function scopedDb(ids: string[]): Database {
  // AND-compose rather than spread-merge: spreading `{ ...args.where, id:
  // { in: ids } }` would let this wrapper's `id` key silently clobber the
  // caller's own `id` filter (e.g. runCli's `deleteMany({ where: { id: {
  // in: safe.map(...) } } })`) instead of narrowing it, which would widen
  // a delete to every row in scope rather than just the ones the real
  // query selected. `AND: [callerWhere, { id: { in: ids } }]` keeps both
  // constraints intact no matter what shape the caller's `where` is.
  return {
    customer: {
      findMany: ((args: Parameters<typeof db.customer.findMany>[0]) =>
        db.customer.findMany({ ...args, where: { AND: [args?.where ?? {}, { id: { in: ids } }] } })) as typeof db.customer.findMany,
      deleteMany: ((args: Parameters<typeof db.customer.deleteMany>[0]) =>
        db.customer.deleteMany({ ...args, where: { AND: [args?.where ?? {}, { id: { in: ids } }] } })) as typeof db.customer.deleteMany,
    },
  } as Database;
}

const createdCustomerIds: string[] = [];

after(async () => {
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
});

function fakeCandidate(overrides: Partial<PhantomCandidate> = {}): PhantomCandidate {
  return {
    id: "c1",
    email: "phantom@example.com",
    name: "Phantom",
    phone: null,
    createdAt: new Date(),
    orderCount: 0,
    addressCount: 0,
    reviewCount: 0,
    tokenCount: 0,
    wishlistCount: 0,
    ...overrides,
  };
}

describe("isProvablySynthetic (pure)", () => {
  it("is true only when every relation count is zero", () => {
    assert.equal(isProvablySynthetic(fakeCandidate()), true);
  });

  for (const field of ["orderCount", "addressCount", "reviewCount", "tokenCount", "wishlistCount"] as const) {
    it(`is false when ${field} > 0`, () => {
      assert.equal(isProvablySynthetic(fakeCandidate({ [field]: 1 })), false);
    });
  }
});

describe("assertNotProductionDatabase (pure)", () => {
  it("throws when DATABASE_URL is unset", () => {
    assert.throws(() => assertNotProductionDatabase(undefined, undefined));
  });

  it("throws when DATABASE_URL equals SUPABASE_DATABASE_URL", () => {
    const url = "postgresql://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    assert.throws(() => assertNotProductionDatabase(url, url));
  });

  it("throws when DATABASE_URL looks like a Supabase host, even if SUPABASE_DATABASE_URL is unset", () => {
    assert.throws(() =>
      assertNotProductionDatabase("postgresql://postgres.xyz:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres", undefined),
    );
    assert.throws(() => assertNotProductionDatabase("postgresql://user:pw@db.myproject.supabase.co:5432/postgres", undefined));
  });

  it("passes for a local Docker Postgres URL distinct from SUPABASE_DATABASE_URL", () => {
    assert.doesNotThrow(() =>
      assertNotProductionDatabase(
        "postgresql://daakyka:daakyka@localhost:5432/daakyka_dev",
        "postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
      ),
    );
  });
});

describe("parseCliArgs (pure)", () => {
  it("defaults to a dry run", () => {
    assert.equal(parseCliArgs([]).execute, false);
  });

  it("recognises --execute", () => {
    assert.equal(parseCliArgs(["--execute"]).execute, true);
  });
});

describe("findPhantomCustomerCandidates + runCli (scoped to this test's own rows)", () => {
  it("selects a zero-everything, unverified, never-logged-in customer but not a real-looking one", async () => {
    const unique = randomUUID().slice(0, 8);

    const phantom = await db.customer.create({
      data: { email: `phantom-${unique}@example.com`, name: "Phantom Row", phone: "9876543210", passwordHash: randomUUID() },
    });
    // A real registration always issues a VERIFY token immediately (see
    // POST /api/account/register) — a row with one looks like a real
    // account mid-signup, not a directly-inserted phantom.
    const realUnverified = await db.customer.create({
      data: { email: `real-unverified-${unique}@example.com`, name: "Real Unverified", passwordHash: randomUUID() },
    });
    await db.customerToken.create({
      data: { customerId: realUnverified.id, type: "VERIFY", tokenHash: `hash-${unique}`, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const ids = [phantom.id, realUnverified.id];
    createdCustomerIds.push(...ids);

    const candidates = await findPhantomCustomerCandidates(scopedDb(ids));
    const candidateIds = candidates.map((c) => c.id);

    assert.ok(candidateIds.includes(phantom.id), "the zero-everything row should be a candidate");
    assert.ok(!candidateIds.includes(realUnverified.id), "a row with a real VERIFY token must never be a candidate");
  });

  it("dry run (default) reports candidates but deletes nothing", async () => {
    const unique = randomUUID().slice(0, 8);
    const phantom = await db.customer.create({
      data: { email: `phantom-dryrun-${unique}@example.com`, name: "Phantom Dry Run", passwordHash: randomUUID() },
    });
    createdCustomerIds.push(phantom.id);

    const code = await runCli([], scopedDb([phantom.id]));
    assert.equal(code, 0);

    const stillThere = await db.customer.findUnique({ where: { id: phantom.id } });
    assert.ok(stillThere, "dry run must never delete anything");
  });

  it("--execute deletes only the provably-synthetic rows in scope, leaving a real-looking one alone", async () => {
    const unique = randomUUID().slice(0, 8);

    const phantom = await db.customer.create({
      data: { email: `phantom-exec-${unique}@example.com`, name: "Phantom Exec", passwordHash: randomUUID() },
    });
    const realCustomer = await db.customer.create({
      data: { email: `real-exec-${unique}@example.com`, name: "Real Exec", passwordHash: randomUUID(), emailVerifiedAt: new Date() },
    });
    const ids = [phantom.id, realCustomer.id];
    createdCustomerIds.push(...ids);

    const code = await runCli(["--execute"], scopedDb(ids));
    assert.equal(code, 0);

    assert.equal(await db.customer.findUnique({ where: { id: phantom.id } }), null, "the phantom row should be deleted");
    assert.ok(await db.customer.findUnique({ where: { id: realCustomer.id } }), "the verified, real-looking row must survive");
  });

  it("never deletes a customer with a real order, even with everything else empty", async () => {
    const unique = randomUUID().slice(0, 8);
    const customer = await db.customer.create({
      data: { email: `has-order-${unique}@example.com`, name: "Has Order", passwordHash: randomUUID() },
    });
    const order = await db.order.create({
      data: {
        number: `DK-PHANTOM-TEST-${unique}`,
        customerId: customer.id,
        email: customer.email,
        shippingAddress: { name: "Has Order", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
        subtotal: 500,
        shipping: 0,
        discount: 0,
        total: 500,
        currency: "INR",
        status: "PENDING_PAYMENT",
        paymentMethod: "RAZORPAY",
      },
    });
    createdCustomerIds.push(customer.id);

    try {
      const candidates = await findPhantomCustomerCandidates(scopedDb([customer.id]));
      assert.ok(!candidates.some((c) => c.id === customer.id), "a customer with a linked order must never be a candidate");

      await runCli(["--execute"], scopedDb([customer.id]));
      assert.ok(await db.customer.findUnique({ where: { id: customer.id } }), "must survive --execute");
    } finally {
      await db.order.delete({ where: { id: order.id } }).catch(() => {});
    }
  });
});
