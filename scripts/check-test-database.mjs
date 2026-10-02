/**
 * Exits non-zero unless the database this run would use is a disposable local
 * one (F-080; rules in scripts/lib/assert-disposable-db.mjs).
 *
 * Two uses, one implementation:
 *   - as a command, from `npm test`, so a wrong DATABASE_URL stops the run
 *     with one clear message before anything starts:
 *       node --env-file-if-exists=.env scripts/check-test-database.mjs
 *   - as a preload (`--import`) in test:unit and test:integration, so no test
 *     file can reach a non-local database however the suite is launched.
 *     Node applies --env-file-if-exists before --import modules, so the
 *     DATABASE_URL checked here is the one the tests will use.
 *
 * It exits rather than throws: a stack trace is no use to someone who just
 * pointed a test run at production.
 */
import { assertDisposableEnvironment } from "./lib/assert-disposable-db.mjs";

try {
  assertDisposableEnvironment(process.env);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
