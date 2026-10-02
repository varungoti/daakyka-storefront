import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { databaseSslModeIssue } from "../../src/lib/env";
import { parseArgs } from "../check-rollback-target.mjs";
import {
  classifyRollbackTarget,
  databaseHostFromUrl,
  databaseUrlSslModeIssue,
  extractCanonicalHref,
  extractDatasourceHosts,
  homepageHasNoindexMeta,
  isLikelyProtectedVercelAlias,
  isRedirectStatus,
  isSsoRedirectLocation,
  pickProductionHostname,
  robotsTxtBlocksAll,
  robotsTxtHasSitemap,
  vercelIgnoreCoversEnvSecrets,
} from "./deploy-checks.mjs";

/**
 * Pure unit tests for scripts/go-live.mjs's preflight/smoke checks — see
 * deploy-checks.mjs's own header comment for the two findings (F-054,
 * F-228) these exist to catch. No network, no DB: every check here is
 * proven correct on fixed strings, independent of the real deployment.
 */

describe("robotsTxtBlocksAll (F-054)", () => {
  it("flags a bare Disallow: / with no Allow rule", () => {
    assert.equal(robotsTxtBlocksAll("User-Agent: *\nDisallow: /"), true);
  });

  it("does not flag the normal allow-most robots.txt", () => {
    const body = "User-Agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout\nSitemap: https://daakyka.com/sitemap.xml";
    assert.equal(robotsTxtBlocksAll(body), false);
  });

  it("does not flag a Disallow: /admin/ style rule", () => {
    assert.equal(robotsTxtBlocksAll("User-Agent: *\nAllow: /\nDisallow: /admin/"), false);
  });
});

describe("robotsTxtHasSitemap", () => {
  it("detects a Sitemap: line", () => {
    assert.equal(robotsTxtHasSitemap("User-Agent: *\nAllow: /\nSitemap: https://daakyka.com/sitemap.xml"), true);
  });

  it("is false when there is none", () => {
    assert.equal(robotsTxtHasSitemap("User-Agent: *\nDisallow: /"), false);
  });
});

describe("homepageHasNoindexMeta (F-054)", () => {
  it("detects the noindex meta tag Next renders when indexing is off", () => {
    assert.equal(
      homepageHasNoindexMeta('<head><meta name="robots" content="noindex, nofollow"/></head>'),
      true,
    );
  });

  it("is false for index,follow", () => {
    assert.equal(homepageHasNoindexMeta('<head><meta name="robots" content="index, follow"/></head>'), false);
  });

  it("is false with no robots meta tag at all", () => {
    assert.equal(homepageHasNoindexMeta("<head><title>DAAKYKA</title></head>"), false);
  });
});

describe("extractCanonicalHref", () => {
  it("extracts the canonical href", () => {
    assert.equal(
      extractCanonicalHref('<link rel="canonical" href="https://storefront-nu-woad.vercel.app/"/>'),
      "https://storefront-nu-woad.vercel.app/",
    );
  });

  it("returns null when there is no canonical tag", () => {
    assert.equal(extractCanonicalHref("<head></head>"), null);
  });
});

describe("isLikelyProtectedVercelAlias (F-007)", () => {
  it("flags the team-scoped -projects.vercel.app alias", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://storefront-varubs-projects.vercel.app"), true);
  });

  it("does not flag the project's own public vercel.app alias", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://storefront-nu-woad.vercel.app"), false);
  });

  it("does not flag a custom domain", () => {
    assert.equal(isLikelyProtectedVercelAlias("https://daakyka.com"), false);
  });

  it("does not throw on a malformed URL", () => {
    assert.equal(isLikelyProtectedVercelAlias("not-a-url"), false);
  });
});

describe("vercelIgnoreCoversEnvSecrets (F-228)", () => {
  it("accepts this repo's actual .vercelignore shape", () => {
    const content = [".env", ".env.*", "!.env*.example", ".claude/", "bin/cloudflared.exe"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), true);
  });

  it("rejects an empty file (the pre-fix state — no .vercelignore at all)", () => {
    assert.equal(vercelIgnoreCoversEnvSecrets(""), false);
  });

  it("rejects a file that only excludes .env.local (the Vercel CLI's own default)", () => {
    assert.equal(vercelIgnoreCoversEnvSecrets(".env.local\n.env.*.local"), false);
  });

  it("rejects a broad .env* rule that wrongly re-ignores the .example templates (negation ordered before the broad rule)", () => {
    // Regression for the exact .gitignore bug this release also fixed:
    // a negation only wins when it comes AFTER the pattern it's meant to
    // un-ignore.
    const content = ["!.env*.example", ".env*"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), false);
  });

  it("accepts the negation ordered after the broad rule", () => {
    const content = [".env*", "!.env*.example"].join("\n");
    assert.equal(vercelIgnoreCoversEnvSecrets(content), true);
  });
});

describe("pickProductionHostname (F-354)", () => {
  it("prefers a custom domain over any *.vercel.app alias", () => {
    const inspect = {
      url: "storefront-kgagbak0s-varubs-projects.vercel.app",
      alias: ["storefront-nu-woad.vercel.app", "daakyka.com"],
    };
    assert.equal(pickProductionHostname(inspect), "daakyka.com");
  });

  it("prefers the public vercel.app alias over the SSO-protected -projects.vercel.app one", () => {
    const inspect = {
      url: "storefront-kgagbak0s-varubs-projects.vercel.app",
      alias: ["storefront-varubs-projects.vercel.app", "storefront-nu-woad.vercel.app"],
    };
    assert.equal(pickProductionHostname(inspect), "storefront-nu-woad.vercel.app");
  });

  it("falls back to whatever hostname it finds when there is no alias array", () => {
    assert.equal(
      pickProductionHostname({ url: "https://storefront-nu-woad.vercel.app" }),
      "storefront-nu-woad.vercel.app",
    );
  });

  it("returns null when nothing hostname-shaped is found", () => {
    assert.equal(pickProductionHostname({ id: "dpl_abc123", readyState: "READY" }), null);
  });

  it("does not throw on null/undefined input", () => {
    assert.equal(pickProductionHostname(null), null);
    assert.equal(pickProductionHostname(undefined), null);
  });
});

describe("isRedirectStatus", () => {
  it("is true for 301/302/307/308", () => {
    for (const status of [301, 302, 307, 308]) assert.equal(isRedirectStatus(status), true);
  });

  it("is false for 200 and 404", () => {
    assert.equal(isRedirectStatus(200), false);
    assert.equal(isRedirectStatus(404), false);
  });
});

describe("isSsoRedirectLocation (F-354)", () => {
  it("flags a redirect to vercel.com/sso-api", () => {
    assert.equal(isSsoRedirectLocation("https://vercel.com/sso-api?url=%2F"), true);
  });

  it("does not flag a redirect within the app's own domain", () => {
    assert.equal(isSsoRedirectLocation("https://daakyka.com/shop"), false);
    assert.equal(isSsoRedirectLocation("/shop"), false);
  });

  it("does not throw on a missing header", () => {
    assert.equal(isSsoRedirectLocation(null), false);
    assert.equal(isSsoRedirectLocation(undefined), false);
  });
});

/**
 * A child-process environment with only what is listed (plus what a process
 * needs to start), so nothing from the developer shell or .env decides a test.
 */
function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot, ...extra } as unknown as NodeJS.ProcessEnv;
}

describe("databaseUrlSslModeIssue (F-371)", () => {
  const table: Array<[string, "missing" | "legacy-alias" | "unverified" | null]> = [
    ["postgresql://u:p@db.example.com:6543/postgres?pgbouncer=true", "missing"],
    ["postgresql://u:p@db.example.com:5432/postgres?ssl=false", "missing"],
    ["postgres://u:p@db.example.com/postgres?sslmode=require", "legacy-alias"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=prefer", "legacy-alias"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=VERIFY-CA", "legacy-alias"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=disable", "unverified"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=allow", "unverified"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=no-verify", "unverified"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=bogus", "unverified"],
    ["postgresql://u:p@db.example.com/postgres?sslmode=verify-full", null],
    ["postgresql://u:p@db.example.com/postgres?pgbouncer=true&sslmode=verify-full", null],
    ["postgresql://u:p@db.example.com/postgres?uselibpqcompat=true&sslmode=require", null],
    ["postgresql://u:p@db.example.com/postgres?ssl=true", null],
    ["postgresql://u:p@localhost:5432/daakyka", null],
    ["postgresql://u:p@127.0.0.1:5432/daakyka", null],
    ["postgresql://u:p@[::1]:5432/daakyka", null],
    ["file:./dev.db", null],
    ["not a url", null],
  ];

  for (const [url, expected] of table) {
    it(`${url} -> ${expected}`, () => {
      assert.equal(databaseUrlSslModeIssue(url), expected);
    });
  }

  it("is null for an unset URL", () => {
    assert.equal(databaseUrlSslModeIssue(undefined), null);
    assert.equal(databaseUrlSslModeIssue(""), null);
  });

  it("agrees with the copy the app uses at boot (src/lib/env.ts)", () => {
    for (const [url] of table) {
      assert.equal(databaseSslModeIssue(url), databaseUrlSslModeIssue(url), url);
    }
    assert.equal(databaseSslModeIssue(undefined), databaseUrlSslModeIssue(undefined));
  });
});

describe("check-deploy-env.mjs sslmode warning (F-371)", () => {
  const productionEnv = {
    AUTH_SECRET: "a".repeat(32),
    CRON_SECRET: "cron-secret",
    NEXT_PUBLIC_SITE_URL: "https://daakyka.com",
    ADMIN_SEED_PASSWORD: "a-genuinely-unique-password-123",
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  };

  function run(databaseUrl: string) {
    return spawnSync(process.execPath, ["scripts/check-deploy-env.mjs", "--production"], {
      encoding: "utf8",
      // Nothing from the developer's shell or .env leaks in: only what is listed here.
      env: childEnv({ ...productionEnv, DATABASE_URL: databaseUrl }),
    });
  }

  it("warns, without failing, when the production DATABASE_URL has no sslmode", () => {
    const result = run("postgresql://u:p@db.example.com:6543/postgres?pgbouncer=true");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no sslmode/);
  });

  it("warns about sslmode=require, naming the pg v9 change", () => {
    const result = run("postgresql://u:p@db.example.com:5432/postgres?sslmode=require");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /pg v9/);
  });

  it("is silent about TLS when sslmode=verify-full", () => {
    const result = run("postgresql://u:p@db.example.com:5432/postgres?sslmode=verify-full");
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /sslmode/);
  });
});

describe("extractDatasourceHosts (F-344)", () => {
  it("reads the host out of Prisma's Datasource line and drops the port", () => {
    const log = 'Datasource "db": PostgreSQL database "postgres", schema "public" at "aws-0-ap-northeast-1.pooler.supabase.com:5432"';
    assert.deepEqual(extractDatasourceHosts(log), ["aws-0-ap-northeast-1.pooler.supabase.com"]);
  });

  it("also reads the shorter form the audit captured, in any case", () => {
    const log = 'datasource "db": PostgreSQL database "neondb" at "EP-SHINY-PINE-AJWG34D2-POOLER.C-3.US-EAST-2.AWS.NEON.TECH"';
    assert.deepEqual(extractDatasourceHosts(log), ["ep-shiny-pine-ajwg34d2-pooler.c-3.us-east-2.aws.neon.tech"]);
  });

  it("de-duplicates repeated lines and finds several databases", () => {
    const log = [
      'Datasource "db": PostgreSQL database "postgres" at "a.example.com:5432"',
      "14 migrations found in prisma/migrations",
      'Datasource "db": PostgreSQL database "postgres" at "a.example.com:5432"',
      'Datasource "db": PostgreSQL database "other" at "b.example.com:6543"',
    ].join("\n");
    assert.deepEqual(extractDatasourceHosts(log), ["a.example.com", "b.example.com"]);
  });

  it("returns nothing for a log with no Datasource line, or no log", () => {
    assert.deepEqual(extractDatasourceHosts("Running build in Washington, D.C.\nCompiled successfully"), []);
    assert.deepEqual(extractDatasourceHosts(undefined), []);
    assert.deepEqual(extractDatasourceHosts(null), []);
  });
});

describe("databaseHostFromUrl (F-344)", () => {
  it("returns only the lower-cased hostname", () => {
    assert.equal(
      databaseHostFromUrl("postgresql://postgres.abc:s3cret%40x@AWS-0-AP-NORTHEAST-1.pooler.supabase.com:5432/postgres"),
      "aws-0-ap-northeast-1.pooler.supabase.com",
    );
  });

  it("is null for nothing usable", () => {
    assert.equal(databaseHostFromUrl(undefined), null);
    assert.equal(databaseHostFromUrl("not a url"), null);
  });
});

describe("classifyRollbackTarget (F-344)", () => {
  const supabase = "aws-0-ap-northeast-1.pooler.supabase.com";
  const supabaseLog = `Datasource "db": PostgreSQL database "postgres", schema "public" at "${supabase}:5432"\n14 migrations found\nNo pending migrations to apply.`;
  const neonLog =
    'Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-shiny-pine-ajwg34d2-pooler.c-3.us-east-2.aws.neon.tech:5432"\n1 migration found';

  it("accepts a build made against the production database", () => {
    const verdict = classifyRollbackTarget(supabaseLog, { expectedHost: supabase });
    assert.equal(verdict.safe, true);
    assert.equal(verdict.confirmed, true);
    assert.equal(verdict.reason, "ok");
  });

  it("matches the expected host case-insensitively", () => {
    assert.equal(classifyRollbackTarget(supabaseLog, { expectedHost: supabase.toUpperCase() }).safe, true);
  });

  it("refuses a build made against the retired Neon database, with or without an expected host", () => {
    for (const options of [{ expectedHost: supabase }, {}]) {
      const verdict = classifyRollbackTarget(neonLog, options);
      assert.equal(verdict.safe, false);
      assert.equal(verdict.reason, "retired-database");
    }
  });

  it("refuses a build made against any other database than the expected one", () => {
    const verdict = classifyRollbackTarget('Datasource "db": PostgreSQL database "x" at "db.other.example:5432"', {
      expectedHost: supabase,
    });
    assert.equal(verdict.safe, false);
    assert.equal(verdict.reason, "wrong-database");
  });

  it("refuses a build whose log mixes the production and a different database", () => {
    const verdict = classifyRollbackTarget(`${supabaseLog}\n${neonLog}`, { expectedHost: supabase });
    assert.equal(verdict.safe, false);
  });

  it("fails closed when the log proves nothing (a Preview build, a truncated log)", () => {
    for (const log of ["", "Running build in Washington, D.C.\nCompiled successfully"]) {
      const verdict = classifyRollbackTarget(log, { expectedHost: supabase });
      assert.equal(verdict.safe, false);
      assert.equal(verdict.reason, "no-datasource");
    }
  });

  it("says so when it can only rule out the retired host and has nothing to compare against", () => {
    const verdict = classifyRollbackTarget(supabaseLog, {});
    assert.equal(verdict.safe, true);
    assert.equal(verdict.confirmed, false);
    assert.equal(verdict.reason, "unconfirmed");
  });
});

describe("check-rollback-target.mjs (F-344)", () => {
  const supabase = "aws-0-ap-northeast-1.pooler.supabase.com";
  const script = path.resolve("scripts/check-rollback-target.mjs");
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "rollback-target-"));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Runs from a scratch directory with no .env and an environment of its own,
  // so a developer's SUPABASE_DATABASE_URL can never decide the outcome.
  function run(args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      cwd: dir,
      env: childEnv(env),
    });
  }

  function logFile(name: string, content: string) {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it("exits 0 for a build against the production database", () => {
    const file = logFile("good.log", `Datasource "db": PostgreSQL database "postgres" at "${supabase}:5432"`);
    const result = run(["--log-file", file, "--expect-host", supabase]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK:/);
  });

  it("reads the expected host from ROLLBACK_EXPECT_DB_HOST or SUPABASE_DATABASE_URL, printing only the host", () => {
    const file = logFile("env.log", `Datasource "db": PostgreSQL database "postgres" at "${supabase}:5432"`);
    assert.equal(run(["--log-file", file], { ROLLBACK_EXPECT_DB_HOST: supabase }).status, 0);
    const viaUrl = run(["--log-file", file], {
      SUPABASE_DATABASE_URL: `postgresql://postgres.abc:topsecret@${supabase}:5432/postgres`,
    });
    assert.equal(viaUrl.status, 0, viaUrl.stderr);
    assert.doesNotMatch(viaUrl.stdout + viaUrl.stderr, /topsecret/);
  });

  it("exits 1 and says not to roll back for a Neon-bound build", () => {
    const file = logFile("neon.log", 'Datasource "db": PostgreSQL database "neondb" at "ep-x-pooler.us-east-2.aws.neon.tech:5432"');
    const result = run(["--log-file", file, "--expect-host", supabase]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DO NOT ROLL BACK/);
  });

  it("exits 1 when the log has no Datasource line", () => {
    const file = logFile("empty.log", "Compiled successfully");
    assert.equal(run(["--log-file", file, "--expect-host", supabase]).status, 1);
  });

  it("exits 1, not 0, when there is no expected host to compare against", () => {
    const file = logFile("unconfirmed.log", `Datasource "db": PostgreSQL database "postgres" at "${supabase}:5432"`);
    const result = run(["--log-file", file]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--expect-host/);
  });

  it("exits 2 on unusable arguments, without running anything", () => {
    assert.equal(run([]).status, 2);
    assert.equal(run(["--bogus"]).status, 2);
    assert.equal(run(["dep.vercel.app", "--log-file", "x"]).status, 2);
    assert.equal(run(["a.vercel.app", "b.vercel.app"]).status, 2);
  });
});

describe("check-rollback-target parseArgs (F-344)", () => {
  it("accepts a deployment url or id", () => {
    assert.equal(parseArgs(["storefront-etbbsb4tk-varubs-projects.vercel.app"]).target, "storefront-etbbsb4tk-varubs-projects.vercel.app");
    assert.equal(parseArgs(["https://storefront-x.vercel.app/"]).target, "https://storefront-x.vercel.app/");
    assert.equal(parseArgs(["dpl_ABC123"]).target, "dpl_ABC123");
  });

  it("rejects anything that could be shell syntax", () => {
    for (const bad of ["a.vercel.app; whoami", "a b", "$(whoami).vercel.app", "a.vercel.app&calc", "x|y", "a.vercel.app`id`"]) {
      assert.ok(parseArgs([bad]).error, bad);
    }
  });

  it("rejects a flag with no value", () => {
    assert.ok(parseArgs(["a.vercel.app", "--expect-host"]).error);
    assert.ok(parseArgs(["--log-file", "--expect-host", "x"]).error);
  });
});
