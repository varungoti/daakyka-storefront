/**
 * Operator-side preflight for an existing Daakyka build login. No hosted changes.
 * Only a verified, independently pinned target and constant read-only SQL.
 */
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { assertMigrationHistory, expectedMigrations } from "./vercel-build.mjs";

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ROLE = /^[a-z][a-z0-9_]{1,62}$/;
const REF = /^[a-z]{20}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DENIED = /^[A-Z][A-Z0-9_]+$/;

class PreflightFailure extends Error {}
const fail = (code) => { throw new PreflightFailure(code); };

export function parseBuildReaderTarget(input, options) {
  const { host, database, role, port, projectRef, localFixture = false } = options;
  if (!ROLE.test(role ?? "") || !ROLE.test(database ?? "") ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !host) {
    fail("EXPECTED_TARGET_REQUIRED");
  }
  let url;
  try { url = new URL(input ?? ""); } catch { fail("READER_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash ||
      url.hostname !== host || Number(url.port || 5432) !== port ||
      url.pathname !== "/" + database) {
    fail("READER_TARGET_MISMATCH");
  }
  if ([...url.searchParams.keys()].some((key) => !["sslmode", "pgbouncer"].includes(key)) ||
      url.searchParams.getAll("pgbouncer").length > 1 ||
      (url.searchParams.has("pgbouncer") && url.searchParams.get("pgbouncer") !== "true")) {
    fail("READER_URL_OPTIONS_NOT_ALLOWED");
  }
  if (localFixture) {
    if (!LOCAL.has(host) || projectRef || url.username !== role ||
        !database.startsWith("daakyka_reader_fixture_") || url.searchParams.size ||
        process.env.VERCEL) {
      fail("FIXTURE_TARGET_NOT_DISPOSABLE");
    }
  } else {
    if (!REF.test(projectRef ?? "") || !url.password ||
        url.searchParams.getAll("sslmode").join(",") !== "verify-full") {
      fail("VERIFIED_TLS_AND_PROJECT_REQUIRED");
    }
    if (/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      if (url.username !== role + "." + projectRef) fail("POOLER_PROJECT_OR_ROLE_MISMATCH");
    } else if (host !== "db." + projectRef + ".supabase.co" || url.username !== role) {
      fail("DIRECT_PROJECT_OR_ROLE_MISMATCH");
    }
  }
  return url.href;
}

// Prisma catalog queries read the review product linkage, status and rating,
// not the customer linkage or comments. These may also hold non-public
// content; access to the named catalog/editable-content tables is a separate
// decision for the data owner. Never grant SELECT across the whole schema.
export const BUILD_READ_TABLES = [
  "_prisma_migrations", "Category", "Product", "ProductVariant", "ProductImage",
  "MediaAsset", "BlogPostRecord", "SiteSetting", "HomepageSection", "SeoPageRecord",
  "TestimonialRecord", "OfferRecommendation", "SizeChart", "Discount",
];
export const BUILD_REVIEW_COLUMNS = ["id", "productId", "status", "rating"];

const ROLE_QUERY = `
SELECT current_user AS role, session_user AS session_role, current_database() AS database,
  current_setting('default_transaction_read_only') = 'on' AS read_by_default,
  current_setting('transaction_read_only') = 'on' AS readonly_now,
  r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR
     r.rolreplication OR r.rolbypassrls) AS scoped_role,
  NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS no_membership,
  NOT has_database_privilege(current_user, current_database(), 'CREATE') AS no_db_create,
  NOT EXISTS (SELECT 1 FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg\\_%'
       AND has_schema_privilege(current_user, n.oid, 'CREATE')) AS no_schema_create,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg\\_%'
       AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
         has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES')
       WHEN c.relkind = 'S' THEN has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE')
       ELSE false END) AS no_writes,
  NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'auth', 'storage')
       AND c.relkind IN ('r','p','v','m','f')
       AND NOT (n.nspname = 'public' AND (c.relname = ANY($1::text[]) OR c.relname = 'Review'))
       AND has_any_column_privilege(current_user, c.oid, 'SELECT')) AS no_private_reads,
  NOT EXISTS (SELECT 1 FROM unnest($1::text[]) rel(name)
    WHERE NOT has_table_privilege(current_user, format('public.%I', rel.name), 'SELECT')) AS all_required_reads,
  NOT EXISTS (SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public."Review"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT (a.attname = ANY($2::text[]))
       AND has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) AS no_private_review_reads,
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS no_public_definer_execute
FROM pg_roles r WHERE r.rolname = current_user`;

const CATALOG_QUERY = `
SELECT
  EXISTS (SELECT 1 FROM public."Product" p INNER JOIN public."Category" c ON c.id = p."categoryId"
           WHERE p.slug = $1 AND p.status = 'ACTIVE' AND c.slug = $2 AND c.active) AS catalog,
  EXISTS (SELECT 1 FROM public."ProductVariant" v INNER JOIN public."Product" p ON p.id = v."productId"
           WHERE p.slug = $1 AND p.status = 'ACTIVE' AND v.active) AS variant,
  EXISTS (SELECT 1 FROM public."ProductImage" i INNER JOIN public."Product" p ON p.id = i."productId"
           INNER JOIN public."MediaAsset" m ON m.id = i."mediaId"
           WHERE p.slug = $1 AND p.status = 'ACTIVE' AND NULLIF(btrim(m.url), '') IS NOT NULL
             AND m.url NOT LIKE '/placeholder-%') AS gallery,
  EXISTS (SELECT 1 FROM public."SiteSetting" s WHERE s.key = $3 AND s.value IS NOT NULL) AS site_setting,
  EXISTS (SELECT 1 FROM public."BlogPostRecord" b WHERE b.slug = $4 AND b.status = 'PUBLISHED'
           AND b."publishedAt" <= CURRENT_TIMESTAMP) AS published_blog`;

export async function verifyBuildReader({ url, host, port, database, role, projectRef, localFixture,
  product, category, setting, blog }) {
  if (![product, category, blog].every((value) => typeof value === "string" && value.length <= 150 && SLUG.test(value)) ||
      !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(setting ?? "") ||
      setting.length > 100) {
    fail("PUBLIC_CATALOG_AND_CONTENT_SENTINELS_REQUIRED");
  }
  const target = new URL(parseBuildReaderTarget(url, { host, port, database, role, projectRef, localFixture }));
  // Pooler URL validation and transport verification are independent. Explicit
  // rejectUnauthorized is not overridden by an ambient Node TLS setting.
  const client = new pg.Client({
    host: host === "[::1]" ? "::1" : host, port, database,
    user: decodeURIComponent(target.username), password: decodeURIComponent(target.password),
    ssl: localFixture ? false : { rejectUnauthorized: true, servername: host },
    connectionTimeoutMillis: 5000, query_timeout: 8000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    if (!localFixture && !client.connection.stream.authorized) fail("TLS_PEER_NOT_VERIFIED");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const { rows: [permissions] } = await client.query(ROLE_QUERY, [BUILD_READ_TABLES, BUILD_REVIEW_COLUMNS]);
    if (!permissions || permissions.role !== role || permissions.session_role !== role ||
        permissions.database !== database) fail("SERVER_IDENTITY_MISMATCH");
    if (!permissions.read_by_default || !permissions.readonly_now || !permissions.scoped_role ||
        !permissions.no_membership || !permissions.no_db_create || !permissions.no_schema_create ||
        !permissions.no_writes || !permissions.no_public_definer_execute) fail("READER_EXCEEDS_WRITE_BOUNDARY");
    if (!permissions.no_private_reads || !permissions.no_private_review_reads) fail("READER_EXCEEDS_READ_BOUNDARY");
    if (!permissions.all_required_reads) fail("READER_REQUIRED_GRANT_MISSING");

    const { rows: migrations } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations"',
    );
    const expected = expectedMigrations();
    try { assertMigrationHistory(expected, migrations); } catch { fail("MIGRATION_HISTORY_MISMATCH"); }

    const { rows: [checks] } = await client.query(CATALOG_QUERY, [product, category, setting, blog]);
    if (!checks?.catalog || !checks.variant) fail("PUBLISHED_CATALOG_NOT_VISIBLE");
    if (!checks.gallery) fail("PUBLISHED_GALLERY_NOT_VISIBLE");
    if (!checks.site_setting || !checks.published_blog) fail("EXPECTED_PUBLIC_CONTENT_NOT_VISIBLE");
    for (const table of BUILD_READ_TABLES) {
      // Names are fixed source constants; no connection- or user-provided identifiers.
      await client.query('SELECT EXISTS (SELECT 1 FROM public."' + table + '" LIMIT 1)');
    }
    await client.query('SELECT EXISTS (SELECT 1 FROM public."Review" r WHERE r.id IS NOT NULL ' +
      "AND r.\"productId\" IS NOT NULL AND r.status = 'APPROVED' AND r.rating IS NOT NULL)");
    await client.query("ROLLBACK");
    return { migrationCount: expected.size, catalog: true, variants: true, gallery: true, publicContent: true };
  } catch (error) {
    if (error instanceof PreflightFailure) throw error;
    if (error?.code === "42501") fail("READER_REQUIRED_GRANT_MISSING");
    fail("READER_CONNECTION_OR_SCHEMA_CHECK_FAILED");
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        host: { type: "string" }, database: { type: "string" }, role: { type: "string" },
        port: { type: "string" }, "project-ref": { type: "string" },
        product: { type: "string" }, category: { type: "string" },
        setting: { type: "string" }, blog: { type: "string" }, "local-fixture": { type: "boolean" },
      },
    });
    const result = await verifyBuildReader({
      ...values, projectRef: values["project-ref"], localFixture: values["local-fixture"],
      port: Number(values.port), url: process.env.BUILD_DATABASE_URL,
    });
    console.log("Read-only Daakyka build reader verified: " + JSON.stringify(result));
  } catch (error) {
    const code = error instanceof PreflightFailure && DENIED.test(error.message) ? error.message : "READER_PREFLIGHT_ARGUMENTS_INVALID";
    console.error("Daakyka build reader preflight refused: " + code);
    process.exitCode = 1;
  }
}
