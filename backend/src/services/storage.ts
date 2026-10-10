// ─────────────────────────────────────────────────────────────────────
// File storage.
//
// Two interchangeable providers behind one interface:
//   • LocalDiskStorage — the default; used whenever no S3 bucket is
//     configured (local dev, CI, tests).
//   • S3Storage        — any S3-compatible object store, signed with
//     AWS Signature V4. Implemented directly on Node's global `fetch` and
//     `node:crypto`, so no SDK dependency is added.
//
// Credentials live only in the server environment (`config.s3*`); they are
// never returned to a client. Object keys are server-generated and every
// caller reaches storage through the owner-scoped resource service.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "@/config";
import { StorageError } from "@/config/errors";

// ─────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────

export interface FileStorage {
  /** Store `body` under `key`. Overwrites an existing object. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Read the object at `key`. Throws a 404 StorageError when absent. */
  get(key: string): Promise<Buffer>;
  /** Remove the object at `key`. Succeeds silently when already absent. */
  delete(key: string): Promise<void>;
}

// ─────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────

/** Build a collision-free, owner-scoped object key for an uploaded file. */
export function storageKeyFor(userId: string, fileName: string): string {
  return `resources/${userId}/${crypto.randomUUID()}/${path.basename(fileName)}`;
}

/**
 * Defence-in-depth: reject a key that could escape the storage root. Keys are
 * always server-generated, so a failure here is an internal bug, not a client
 * input.
 */
function assertSafeKey(key: string): void {
  const segments = key.split("/");
  const bad =
    !key ||
    key.includes("\\") ||
    key.startsWith("/") ||
    segments.some((s) => s === "" || s === "." || s === "..");
  if (bad) throw new StorageError("Invalid storage key", 500, "STORAGE_ERROR");
}

// ─────────────────────────────────────────────
// Local disk provider
// ─────────────────────────────────────────────

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new StorageError("Invalid storage key", 500, "STORAGE_ERROR");
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    } catch (error) {
      throw wrapLocalError(error, "Failed to store the uploaded file");
    }
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    try {
      return await fs.readFile(full);
    } catch (error) {
      throw wrapLocalError(error, "The stored file could not be found");
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    try {
      await fs.unlink(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // already gone
      throw wrapLocalError(error, "Failed to remove the stored file");
    }
  }
}

function wrapLocalError(error: unknown, message: string): StorageError {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return new StorageError(message, 404, "NOT_FOUND");
  }
  return new StorageError(message, 503, "STORAGE_ERROR");
}

// ─────────────────────────────────────────────
// S3-compatible provider (AWS Signature V4)
// ─────────────────────────────────────────────

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  usePathStyle: boolean;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for deterministic signing in tests. */
  now?: () => Date;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export class S3Storage implements FileStorage {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: S3StorageOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private sign(method: string, key: string, payload: Buffer, contentType?: string): SignedRequest {
    const { endpoint, region, accessKeyId, secretAccessKey, bucket, usePathStyle } = this.options;

    const base = new URL(endpoint);
    const host = usePathStyle ? base.host : `${bucket}.${base.host}`;
    const encodedKey = encodeKeyPath(key);
    const pathname = usePathStyle ? `/${bucket}/${encodedKey}` : `/${encodedKey}`;
    const url = `${base.protocol}//${host}${pathname}`;

    const amzDate = formatAmzDate(this.now());
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);

    const canonicalHeaders =
      `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      pathname,
      "", // no query string on these operations
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(Buffer.from(canonicalRequest)),
    ].join("\n");

    const signature = hmac(signingKey(secretAccessKey, dateStamp, region), stringToSign).toString("hex");

    const headers: Record<string, string> = {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["Content-Type"] = contentType;

    return { url, headers };
  }

  private async send(method: string, key: string, body: Buffer, contentType?: string): Promise<Response> {
    const { url, headers } = this.sign(method, key, body, contentType);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: method === "DELETE" || method === "GET" ? undefined : new Uint8Array(body),
      });
    } catch {
      throw new StorageError("The storage provider is unreachable", 503, "STORAGE_ERROR");
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new StorageError("The stored file could not be found", 404, "NOT_FOUND");
      }
      throw new StorageError("The storage provider rejected the request", 503, "STORAGE_ERROR");
    }
    return response;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.send("PUT", key, body, contentType);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.send("GET", key, Buffer.alloc(0));
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    try {
      await this.send("DELETE", key, Buffer.alloc(0));
    } catch (error) {
      // A missing object is a successful delete (idempotent).
      if (error instanceof StorageError && error.statusCode === 404) return;
      throw error;
    }
  }
}

// ── Signing primitives ────────────────────────────────────────────────

function sha256Hex(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function formatAmzDate(date: Date): string {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260101T000000Z
  return iso.endsWith("Z") ? iso : `${iso}Z`;
}

/** AWS canonical URI encoding: unreserved characters stay, `/` is preserved. */
function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => {
      const bytes = Buffer.from(segment, "utf8");
      let out = "";
      for (const byte of bytes) {
        const unreserved =
          (byte >= 0x41 && byte <= 0x5a) ||
          (byte >= 0x61 && byte <= 0x7a) ||
          (byte >= 0x30 && byte <= 0x39) ||
          byte === 0x2d ||
          byte === 0x5f ||
          byte === 0x2e ||
          byte === 0x7e;
        out += unreserved ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      return out;
    })
    .join("/");
}

// ─────────────────────────────────────────────
// Factory / singleton
// ─────────────────────────────────────────────

/** Choose the provider from configuration. S3 wins when credentials exist. */
export function createFileStorage(): FileStorage {
  if (config.s3Endpoint && config.s3AccessKeyId && config.s3SecretAccessKey) {
    return new S3Storage({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
      bucket: config.s3Bucket,
      usePathStyle: config.s3UsePathStyle,
    });
  }
  return new LocalDiskStorage(config.uploadDir);
}

let current: FileStorage | null = null;

/** The process-wide provider, created lazily on first use. */
export function getFileStorage(): FileStorage {
  if (!current) current = createFileStorage();
  return current;
}

/** Replace the provider (tests). Pass `null` to reset to the configured one. */
export function setFileStorage(storage: FileStorage | null): void {
  current = storage;
}
