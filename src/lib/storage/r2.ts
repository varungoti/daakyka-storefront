/**
 * Cloudflare R2 object storage (S3-compatible API).
 *
 * Server-only: never import this from a client component. Credentials are
 * read from process.env at call time (never cached into a committed file,
 * never logged) so the module loads fine even when R2 isn't configured yet
 * — callers must check `isR2Configured()` first and handle the "not
 * configured" case gracefully (see StorageNotConfiguredError below).
 */
import https from "node:https";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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

// Accepts CLOUDFLARE_* names as a fallback to R2_* — this deployment's
// .env was populated under the Cloudflare-prefixed names (account
// dashboard convention) rather than this app's own R2_* convention.
function readR2Env(): R2Env | null {
  const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
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
      // Always derive the endpoint from the account id rather than trusting
      // a separately-configured endpoint env var — the two can drift out
      // of sync (observed in practice: an updated account id with a stale
      // endpoint value silently pointed requests at the wrong account).
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
      // The AWS SDK's default Node request handler negotiates a TLS
      // handshake that this environment's network path hard-rejects
      // against R2's endpoint (confirmed: plain `https.request` and
      // PowerShell's .NET TLS stack both connect fine against the same
      // host/port, but the SDK's own handler fails before a certificate is
      // even exchanged). Forcing a plain `https.Agent` with Node's default
      // TLS options sidesteps whatever the SDK handler sets that trips
      // this — verified working for HeadBucket/PutObject/GetObject/
      // DeleteObject against the real endpoint.
      requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true }) }),
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
