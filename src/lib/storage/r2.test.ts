import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertBucketIsWritable, ProductionBucketWriteBlockedError } from "@/lib/storage/r2";
import { withEnv } from "../../../tests/helpers/env";

/**
 * F-302 (release-hardening media-storage-integrity): local dev, the
 * localhost audit build, and every script that isn't the real Vercel
 * production deployment must never write to or delete from the actual
 * production R2 bucket, even though `R2_BUCKET` in the laptop's `.env`
 * currently names it. `assertBucketIsWritable` is the one guard every
 * write/delete in this module calls before ever reaching R2 — see
 * `uploadObject`/`deleteObject`/`getPresignedUploadUrl`.
 */
describe("assertBucketIsWritable (pure — no network call)", () => {
  it("throws for the default production bucket name outside production", async () => {
    await withEnv({ VERCEL_ENV: undefined, R2_ALLOW_PROD_BUCKET_WRITES: undefined, R2_PRODUCTION_BUCKET: undefined }, () => {
      assert.throws(() => assertBucketIsWritable("daakyka-media"), ProductionBucketWriteBlockedError);
    });
  });

  it("does not throw for a bucket name that isn't the production bucket", async () => {
    await withEnv({ VERCEL_ENV: undefined, R2_ALLOW_PROD_BUCKET_WRITES: undefined, R2_PRODUCTION_BUCKET: undefined }, () => {
      assert.doesNotThrow(() => assertBucketIsWritable("daakyka-media-dev"));
    });
  });

  it("does not throw for the production bucket when VERCEL_ENV is really 'production'", async () => {
    await withEnv({ VERCEL_ENV: "production", R2_ALLOW_PROD_BUCKET_WRITES: undefined, R2_PRODUCTION_BUCKET: undefined }, () => {
      assert.doesNotThrow(() => assertBucketIsWritable("daakyka-media"));
    });
  });

  it("still throws on a Vercel preview deployment (VERCEL_ENV=preview is not real production)", async () => {
    await withEnv({ VERCEL_ENV: "preview", R2_ALLOW_PROD_BUCKET_WRITES: undefined, R2_PRODUCTION_BUCKET: undefined }, () => {
      assert.throws(() => assertBucketIsWritable("daakyka-media"), ProductionBucketWriteBlockedError);
    });
  });

  it("does not throw when explicitly overridden with R2_ALLOW_PROD_BUCKET_WRITES=1", async () => {
    await withEnv({ VERCEL_ENV: undefined, R2_ALLOW_PROD_BUCKET_WRITES: "1", R2_PRODUCTION_BUCKET: undefined }, () => {
      assert.doesNotThrow(() => assertBucketIsWritable("daakyka-media"));
    });
  });

  it("respects a configured R2_PRODUCTION_BUCKET name instead of the hard-coded default", async () => {
    await withEnv({ VERCEL_ENV: undefined, R2_ALLOW_PROD_BUCKET_WRITES: undefined, R2_PRODUCTION_BUCKET: "some-other-prod-bucket" }, () => {
      assert.doesNotThrow(() => assertBucketIsWritable("daakyka-media"), "no longer the configured production bucket name");
      assert.throws(() => assertBucketIsWritable("some-other-prod-bucket"), ProductionBucketWriteBlockedError);
    });
  });
});
