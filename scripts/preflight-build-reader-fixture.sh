#!/usr/bin/env bash
# Opt-in integration controls. Creates its own temporary localhost cluster.
set +x
set -euo pipefail
umask 077

if [[ -n ${VERCEL:-} ]]; then
  echo 'This fixture cannot run during a Vercel build.' >&2
  exit 1
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -n ${DAAKYKA_TEST_PG_BIN:-} ]]; then
  pg="$DAAKYKA_TEST_PG_BIN"
else
  pg="$(pg_config --bindir)"
fi
for binary in initdb pg_ctl psql; do test -x "$pg/$binary"; done
test -x ./node_modules/.bin/prisma
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE
unset DATABASE_URL MIGRATION_DATABASE_URL SUPABASE_DATABASE_URL BUILD_DATABASE_URL
d="$(mktemp -d /tmp/daakyka-reader-fixture-XXXXXXXX)"
started=0
cleanup() {
  if [[ "$started" = 1 ]]; then
    if ! "$pg/pg_ctl" -D "$d/data" -w -m fast stop >"$d/stop.log" 2>&1; then
      printf 'Stopping the disposable cluster failed: %s\n' "$d" >&2
      exit 1
    fi
  fi
  if [[ -n ${DAAKYKA_KEEP_FIXTURE_LOGS:-} ]]; then
    # Retain receipts only. A password file and initialized cluster are not evidence.
    if [[ -f "$d/data/postmaster.pid" ]]; then exit 1; fi
    rm -rf -- "$d/data" "$d/owner-password"
    printf 'Fixture logs: %s\n' "$d"
  else
    rm -rf -- "$d"
  fi
}
trap cleanup EXIT
port="$(node -e 'const s=require("node:net").createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();})')"
database=daakyka_reader_fixture_test
owner_pass="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
reader_pass="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("hex"))')"
printf '%s\n' "$owner_pass" > "$d/owner-password"
"$pg/initdb" -D "$d/data" -U detached_fixture_owner --auth-host=scram-sha-256 --auth-local=scram-sha-256 \
  --pwfile="$d/owner-password" --no-locale --encoding=UTF8 >"$d/initdb.log" 2>&1
if ! "$pg/pg_ctl" -D "$d/data" -l "$d/pg.log" -o "-p $port -h 127.0.0.1 -c unix_socket_directories=" -w start >"$d/start.log" 2>&1; then
  # pg_ctl can time out while startup is still in progress.
  if [[ -f "$d/data/postmaster.pid" ]]; then started=1; fi
  cat "$d/start.log" >&2
  exit 1
fi
started=1
psql() {
  PGPASSWORD="$owner_pass" "$pg/psql" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -U detached_fixture_owner "$@"
}
psql -d postgres -c 'CREATE DATABASE daakyka_reader_fixture_test' >"$d/create.log" 2>&1
writer_url="postgresql://detached_fixture_owner:$owner_pass@127.0.0.1:$port/$database"
DATABASE_URL="$writer_url" MIGRATION_DATABASE_URL="$writer_url" node scripts/check-test-database.mjs
DATABASE_URL="$writer_url" MIGRATION_DATABASE_URL="$writer_url" DOTENV_CONFIG_PATH=/dev/null \
  ./node_modules/.bin/prisma migrate deploy >"$d/migrate.log" 2>&1
unset writer_url
export BUILD_DATABASE_URL="postgresql://daakyka_build_reader:$reader_pass@127.0.0.1:$port/$database"
PREFLIGHT_FIXTURE_READER_PASSWORD="$reader_pass" psql -d "$database" >"$d/rows.log" 2>&1 <<'SQL'
\getenv reader_pw PREFLIGHT_FIXTURE_READER_PASSWORD
CREATE ROLE daakyka_build_reader LOGIN NOINHERIT NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD :'reader_pw';
ALTER ROLE daakyka_build_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE daakyka_reader_fixture_test TO daakyka_build_reader;
GRANT USAGE ON SCHEMA public TO daakyka_build_reader;
GRANT SELECT ON TABLE public."_prisma_migrations", public."Category", public."Product",
 public."ProductVariant", public."ProductImage", public."MediaAsset", public."BlogPostRecord",
 public."SiteSetting", public."HomepageSection", public."SeoPageRecord", public."TestimonialRecord",
 public."OfferRecommendation", public."SizeChart", public."Discount" TO daakyka_build_reader;
GRANT SELECT (id, "productId", status, rating) ON TABLE public."Review" TO daakyka_build_reader;
INSERT INTO public."Category" (id,slug,name,"updatedAt") VALUES ('synthetic-cat','fixture-cat','Synthetic Cat',now());
INSERT INTO public."Product" (id,slug,name,"categoryId",status,price,"updatedAt")
 VALUES ('synthetic-product','fixture-hoodie','Synthetic Hoodie','synthetic-cat','ACTIVE',10,now());
INSERT INTO public."ProductVariant" (id,"productId",sku,size,color,"updatedAt")
 VALUES ('synthetic-variant','synthetic-product','SYNTH','M','Blue',now());
INSERT INTO public."MediaAsset" (id,key,url,usage,"updatedAt") VALUES ('synthetic-photo','fixture/photo','/images/fixture-photo.webp','PRODUCT',now());
INSERT INTO public."ProductImage" (id,"productId","mediaId","updatedAt") VALUES ('synthetic-product-photo','synthetic-product','synthetic-photo',now());
INSERT INTO public."SiteSetting" (id,key,value,"updatedAt") VALUES ('synthetic-setting','shipping.flatRate','10'::jsonb,now());
INSERT INTO public."BlogPostRecord"
 (id,slug,title,excerpt,category,author,"publishedAt","readTime",image,content,status,"updatedAt")
 VALUES ('synthetic-blog','fixture-published','Synthetic post','Summary','Tests','Synthetic',now() - interval '1 day','1 min','/test.svg','[]','PUBLISHED',now());
SQL
receiver() {
  node scripts/preflight-build-reader.mjs --local-fixture --host=127.0.0.1     --port="$port" --database="$database" --role=daakyka_build_reader     --product=fixture-hoodie --category=fixture-cat --setting=shipping.flatRate --blog=fixture-published
}
mutate() { psql -d "$database" -c "$1" >"$d/mutations.log" 2>&1; }
deny() {
  local id="$1" expected="$2"
  set +e; receiver >"$d/$id.log" 2>&1; local status=$?; set -e
  test "$status" -eq 1
  grep -Fxq "Daakyka build reader preflight refused: $expected" "$d/$id.log"
  printf 'PASS %s blocked with %s\n' "$id" "$expected"
}
receiver | tee "$d/positive.log"
grep -q '"migrationCount":' "$d/positive.log"
mutate 'ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY'
deny rls-hidden-catalog PUBLISHED_CATALOG_NOT_VISIBLE
mutate 'ALTER TABLE public."Product" DISABLE ROW LEVEL SECURITY'
mutate 'UPDATE public."ProductVariant" SET active=false'
deny archived-only-variants PUBLISHED_CATALOG_NOT_VISIBLE
mutate 'UPDATE public."ProductVariant" SET active=true'
mutate 'ALTER TABLE public."MediaAsset" ENABLE ROW LEVEL SECURITY'
deny hidden-gallery PUBLISHED_GALLERY_NOT_VISIBLE
mutate 'ALTER TABLE public."MediaAsset" DISABLE ROW LEVEL SECURITY'
mutate 'UPDATE public."MediaAsset" SET url=$$/placeholder-product.svg$$'
deny placeholder-gallery PUBLISHED_GALLERY_NOT_VISIBLE
mutate 'UPDATE public."MediaAsset" SET url=$$/images/fixture-photo.webp$$'

mutate 'ALTER TABLE public."BlogPostRecord" ENABLE ROW LEVEL SECURITY'
deny hidden-blog EXPECTED_PUBLIC_CONTENT_NOT_VISIBLE
mutate 'ALTER TABLE public."BlogPostRecord" DISABLE ROW LEVEL SECURITY'
mutate 'REVOKE SELECT ON TABLE public."HomepageSection" FROM daakyka_build_reader'
deny missing-fallback-grant READER_REQUIRED_GRANT_MISSING
mutate 'GRANT SELECT ON TABLE public."HomepageSection" TO daakyka_build_reader'
mutate 'GRANT SELECT (id) ON TABLE public."Customer" TO daakyka_build_reader'
deny private-column-readable READER_EXCEEDS_READ_BOUNDARY
mutate 'REVOKE SELECT (id) ON TABLE public."Customer" FROM daakyka_build_reader'
mutate 'GRANT SELECT ON TABLE public."Review" TO daakyka_build_reader'
deny broad-review-readable READER_EXCEEDS_READ_BOUNDARY
mutate 'REVOKE SELECT ON TABLE public."Review" FROM daakyka_build_reader'
mutate 'GRANT UPDATE (name) ON TABLE public."Product" TO daakyka_build_reader'
deny column-write-grant READER_EXCEEDS_WRITE_BOUNDARY
mutate 'REVOKE UPDATE (name) ON TABLE public."Product" FROM daakyka_build_reader'
mutate 'ALTER ROLE daakyka_build_reader RESET default_transaction_read_only'
deny readonly-default-missing READER_EXCEEDS_WRITE_BOUNDARY
mutate 'ALTER ROLE daakyka_build_reader SET default_transaction_read_only = on'
mutate 'GRANT pg_read_all_data TO daakyka_build_reader'
deny extra-membership READER_EXCEEDS_WRITE_BOUNDARY
mutate 'REVOKE pg_read_all_data FROM daakyka_build_reader'
mutate 'UPDATE public."_prisma_migrations" SET checksum=repeat('"'0'"',64) WHERE migration_name=(SELECT min(migration_name) FROM public."_prisma_migrations")'
deny drifted-ledger MIGRATION_HISTORY_MISMATCH
