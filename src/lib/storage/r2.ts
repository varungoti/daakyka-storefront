/**
 * Cloudflare R2 object storage (S3-compatible API).
 *
 * Server-only: never import this from a client component. Credentials are
 * read from process.env at call time (never cached into a committed file,
 * never logged) so the module loads fine even when R2 isn't configured yet
 * — callers must check `isR2Configured()` first and handle the "not
 * configured" case gracefully (see StorageNotConfiguredError below).
 */
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class StorageNotConfiguredError extends Error {
  constructor(message = "Cloudflare R2 storage is not configured") {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readR2Env(): R2Env | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isR2Configured(): boolean {
  return readR2Env() !== null;
}

// Cached per accountId/accessKeyId pair so a changed env (e.g. between
// test cases using withEnv) doesn't reuse a stale client.
let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

function getClient(env: R2Env): S3Client {
  const key = `${env.accountId}:${env.accessKeyId}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

function requireEnv(): R2Env {
  const env = readR2Env();
  if (!env) throw new StorageNotConfiguredError();
  return env;
}

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const env = requireEnv();
  await getClient(env).send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  const env = requireEnv();
  await getClient(env).send(
    new DeleteObjectCommand({ Bucket: env.bucket, Key: key }),
  );
}

/**
 * A presigned direct-to-R2 upload URL. Not currently wired to an admin API
 * route — see the doc comment on the multipart upload route
 * (src/app/api/admin/media/route.ts) for why direct server-side upload is
 * used instead for now. Kept here as a complete, tested building block of
 * the storage lib for a future client-side-upload flow (e.g. very large
 * files that shouldn't transit the Next.js server function).
 *
 * Note: an S3 presigned PUT URL cannot itself cap the uploaded byte count
 * (that requires a presigned POST policy with content-length-range); a
 * caller relying on `maxBytes` for enforcement must still verify the
 * object's actual size after upload (e.g. via HeadObject) before trusting
 * it.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  maxBytes: number,
  expiresSeconds = 300,
): Promise<string> {
  const env = requireEnv();
  void maxBytes; // documented caveat above — not enforced by the presigned URL itself
  const command = new PutObjectCommand({
    Bucket: env.bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(env), command, { expiresIn: expiresSeconds });
}

export function publicUrlForKey(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) {
    throw new StorageNotConfiguredError("R2_PUBLIC_BASE_URL is not configured");
  }
  return `${base.replace(/\/$/, "")}/${key}`;
}
