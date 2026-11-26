# Daakyka Vercel build-reader unblock

This supplements Phase B in [GO_LIVE_RUNBOOK](GO_LIVE_RUNBOOK.md); the preflight does **not** provision or deploy anything. It never uses the runtime/owner/migration URL, never emits connection strings or SQL values, and does not change the production build command. A successful local fixture is not a hosted readback or a deployable artifact.

1. **Pin the target, not just its hostname.** In an already approved Supabase admin session, confirm the exact production project reference, database name, and pooler host against Daakyka’s existing runtime binding. A shared pooler host alone is not evidence of the project. Do not switch credentials/accounts to work around an access denial. Stop if you cannot independently match the target. See [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) and [custom Postgres roles](https://supabase.com/docs/guides/database/postgres/roles).

2. **Have the authorized database owner provision/reuse only the reviewed dedicated build role.** Production and nonproduction must not share credentials. The role needs LOGIN, no inherited memberships, NOINHERIT, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, and a default read-only transaction. Grant CONNECT only on the pinned database and USAGE on the app schema. Do not use a runtime writer, owner, migration role, service-role API credential, or legacy connection string. Do not grant SELECT on all tables or add blanket default grants. Do not change shared PUBLIC privileges or RLS policies just to pass a build. If those are the issue, stop and ask the database owner to review effective privileges.

   The preflight’s fixed list enumerates this source’s build-visible catalog and hosted anonymous page data; the owner must review that scope before granting it. Grant ordinary SELECT **only** on the exact named tables. The Review relation is column-scoped to id, productId, status and rating; no customer IDs, author information, comments, or review state beyond the selected status field. Some build-read tables can include unpublished catalog/content, unused media metadata, settings or discount codes; the role’s custodians must be authorized for that scope. Do not repurpose an unfamiliar existing login or reset it blindly.

   In a verified, approved **operator** session only, the role/grant shape is:

   ```sql
   -- Replace PINNED_DATABASE with the already verified database identifier.
   -- If the role already exists, don't recreate or blindly alter it.
   BEGIN;
   CREATE ROLE daakyka_build_reader LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   ALTER ROLE daakyka_build_reader SET default_transaction_read_only = on;
   GRANT CONNECT ON DATABASE "PINNED_DATABASE" TO daakyka_build_reader;
   GRANT USAGE ON SCHEMA public TO daakyka_build_reader;
   GRANT SELECT ON TABLE
     public."_prisma_migrations", public."Category", public."Product", public."ProductVariant",
     public."ProductImage", public."MediaAsset", public."BlogPostRecord", public."SiteSetting",
     public."HomepageSection", public."SeoPageRecord", public."TestimonialRecord",
     public."OfferRecommendation", public."SizeChart", public."Discount"
   TO daakyka_build_reader;
   GRANT SELECT (id, "productId", status, rating) ON TABLE public."Review" TO daakyka_build_reader;
   COMMIT;
   ```

   Set a strong unique password through an approved secret flow, for example psql’s interactive `\password daakyka_build_reader` in that operator session. Never put passwords in SQL scripts, logs, shell arguments, tickets, Git, or chat.

3. **Verify the role before exposing it to Vercel.** Put the dedicated URL in the approved secret store and inject it as the process-only `BUILD_DATABASE_URL` for this check; don't load the normal project .env. A shared-pooler URL must use `<role>.<project-ref>`; the same pooler host as the existing application binding with session port 5432 is appropriate if deployed and allowed. Require `sslmode=verify-full`.

   ```bash
   node scripts/preflight-build-reader.mjs \
     --host=PINNED_HOST --port=5432 --database=PINNED_DATABASE \
     --project-ref=PINNED_PROJECT_REF --role=daakyka_build_reader \
     --product=PUBLIC_PRODUCT_SLUG --category=ITS_ACTIVE_CATEGORY_SLUG \
     --setting=shipping.flatRate --blog=KNOWN_PUBLISHED_BLOG_SLUG
   ```

   Use a storefront-confirmed product with an active variant and catalog photography, its own current active category (not a top-level parent), and a published blog slug from the intended environment. The database check proves the photo record is readable; CDN delivery is a separate staged browser check. Confirm the chosen expected public setting is represented by a database row there; a legitimate default without a row is not evidence of DB visibility. The check will fail if the permissions/schema are correct but RLS hides real content, which is precisely what a `LIMIT 0` privilege-only check cannot catch.

4. **Stage, verify, then promote separately.** Set only the dedicated URL as a Secret in the exact Vercel project/environment. Do not modify the app or migration secret; do not apply migrations to satisfy this check. Build the exact reviewed source with no domain assignment. Verify real product/variants/images/categories, public content, and no fallback indication; check prior-production rollback tenant plus migration compatibility, not hostname alone. Assign public traffic only after the owner’s release authorization and verified smoke results. If the role's read-only grant list misses a genuine compile dependency, investigate the exact read; never fix that by allowing unrelated writes or broad reads.

## Local regression checks

Start from the repository root after the normal locked install. These use no service accounts or hosted database.

```bash
node --test scripts/preflight-build-reader.test.mjs
bash scripts/preflight-build-reader-fixture.sh
```

The second command requires local PostgreSQL server/client binaries on Linux or macOS (`pg_config --bindir`, or point `DAAKYKA_TEST_PG_BIN` at a specific installation). It initializes a new password-protected loopback-only database, applies the exact checked-out migrations there, and destroys that database afterward. It covers real storefront rows alongside RLS-hidden media/content/catalog, disabled variants, stale migration checksums, narrow reads, excessive grants, and role defaults. `DAAKYKA_KEEP_FIXTURE_LOGS=1` retains local diagnostics, never the database or password file. Never point this script at a deployed database.
