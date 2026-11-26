import assert from "node:assert/strict";
import test from "node:test";
import { parseBuildReaderTarget } from "./preflight-build-reader.mjs";

const host = "aws-0-ap-south-1.pooler.supabase.com";
const role = "daakyka_build_reader";
const projectRef = "abcdefghijklmnopqrst";
const options = { host, role, port: 5432, projectRef, database: "postgres" };
const input = `postgresql://${role}.${projectRef}:fixture-password@${host}:5432/postgres?sslmode=verify-full`;

test("independently pinned shared pooler and direct endpoints accept only verified TLS", () => {
  assert.equal(parseBuildReaderTarget(input, options), input);
  const direct = "db." + projectRef + ".supabase.co";
  const href = `postgresql://${role}:fixture-password@${direct}:5432/postgres?sslmode=verify-full`;
  assert.equal(parseBuildReaderTarget(href, { ...options, host: direct }), href);
  assert.throws(() => parseBuildReaderTarget(input.replace("verify-full", "require"), options),
    /VERIFIED_TLS_AND_PROJECT_REQUIRED/);
  assert.throws(() => parseBuildReaderTarget(input + "&sslmode=verify-full", options),
    /VERIFIED_TLS_AND_PROJECT_REQUIRED/);
});

test("shared pooler rejects the wrong tenant or login, even with identical host and database", () => {
  assert.throws(() => parseBuildReaderTarget(input.replace(projectRef, "zyxwvutsrqponmlkjihg"), options),
    /POOLER_PROJECT_OR_ROLE_MISMATCH/);
  assert.throws(() => parseBuildReaderTarget(input.replace(role, "postgres"), options),
    /POOLER_PROJECT_OR_ROLE_MISMATCH/);
});

test("conflicting host, database and query overrides cannot redirect the connection", () => {
  for (const arg of ["host=other.invalid", "hostaddr=127.0.0.1", "options=-cfoo", "sslkey=private.key"]) {
    assert.throws(() => parseBuildReaderTarget(input + "&" + arg, options), /READER_URL_OPTIONS_NOT_ALLOWED/);
  }
  assert.throws(() => parseBuildReaderTarget(input.replace("5432", "6543"), options), /READER_TARGET_MISMATCH/);
  assert.throws(() => parseBuildReaderTarget(input.replace("/postgres?", "/different?"), options), /READER_TARGET_MISMATCH/);
});

test("fixture mode is explicit and cannot accept hosted or conventional local databases", () => {
  const fixture = { host: "127.0.0.1", role, port: 45381, database: "daakyka_reader_fixture_nov26", localFixture: true };
  const href = `postgresql://${role}@127.0.0.1:45381/${fixture.database}`;
  assert.equal(parseBuildReaderTarget(href, fixture), href);
  assert.throws(() => parseBuildReaderTarget(href, { ...fixture, localFixture: false }),
    /VERIFIED_TLS_AND_PROJECT_REQUIRED/);
  assert.throws(() => parseBuildReaderTarget(href.replace(fixture.database, "postgres"), { ...fixture, database: "postgres" }),
    /FIXTURE_TARGET_NOT_DISPOSABLE/);
  assert.throws(() => parseBuildReaderTarget(input, { ...options, localFixture: true }), /FIXTURE_TARGET_NOT_DISPOSABLE/);
});
