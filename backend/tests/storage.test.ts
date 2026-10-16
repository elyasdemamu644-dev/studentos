import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalDiskStorage, S3Storage, storageKeyFor } from "@/services/storage";
import { ApiError, StorageError } from "@/config/errors";
import {
  detectMimeType,
  resolveUploadMimeType,
  sanitizeFileName,
  assertValidFileName,
  UPLOAD_ERROR_CODES,
} from "@/utils/file-validation";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0x01),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x02)]);

// ─────────────────────────────────────────────
// Content sniffing + policy
// ─────────────────────────────────────────────

describe("file validation", () => {
  it("sniffs concrete types from magic bytes and rejects unknown binary", () => {
    expect(detectMimeType(PDF)).toBe("application/pdf");
    expect(detectMimeType(PNG)).toBe("image/png");
    expect(detectMimeType(JPEG)).toBe("image/jpeg");
    expect(detectMimeType(Buffer.from("just some text"))).toBe("text/plain");
    expect(detectMimeType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // MZ
  });

  it("does not trust the client MIME type: sniffed content wins", () => {
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
    // Client claims PDF, bytes are PNG → stored as image/png.
    expect(resolveUploadMimeType("application/pdf", detectMimeType(PNG), allowed)).toBe("image/png");
    // Client claims PDF but the bytes are a JPEG that the policy forbids.
    expect(() =>
      resolveUploadMimeType("application/pdf", detectMimeType(JPEG), new Set(["application/pdf"])),
    ).toThrow(/not allowed/i);
  });

  it("rejects unknown binary content outright", () => {
    expect(() =>
      resolveUploadMimeType("application/pdf", null, new Set(["application/pdf"])),
    ).toThrow(/not allowed/i);
  });

  it("stores unknown binary as octet-stream when arbitrary types are allowed", () => {
    expect(
      resolveUploadMimeType(
        "application/x-custom",
        detectMimeType(Buffer.from([0x00, 0x01, 0xff, 0x02])),
        new Set(["application/pdf"]),
        true,
      ),
    ).toBe("application/octet-stream");
  });

  it("uses sniffed MIME types for arbitrary uploads instead of trusting the declaration", () => {
    const gif = Buffer.from("GIF89a");
    expect(resolveUploadMimeType("application/x-custom", detectMimeType(gif), new Set(), true)).toBe(
      "image/gif",
    );
  });

  it("accepts only allow-listed OOXML/OLE subtypes for container formats", () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
    const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    expect(resolveUploadMimeType(pptx, detectMimeType(zip), new Set([pptx]))).toBe(pptx);
    // A zip declared as a PDF is not an allowed office subtype → rejected.
    expect(() =>
      resolveUploadMimeType("application/pdf", detectMimeType(zip), new Set([pptx])),
    ).toThrow(/not allowed/i);
  });

  it("validates the original filename and rejects path-like names", () => {
    expect(assertValidFileName(" lecture notes.pdf ")).toBe("lecture notes.pdf");

    for (const bad of ["../evil.pdf", "a/b.pdf", "a\\b.pdf", "", "   ", "..", "x\u0000y.pdf"]) {
      let caught: unknown;
      try {
        assertValidFileName(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught, `expected "${bad}" to be rejected`).toBeInstanceOf(ApiError);
      expect((caught as ApiError).code).toBe(UPLOAD_ERROR_CODES.INVALID_FILE_NAME);
    }
  });

  it("sanitizes a name to a safe key segment", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("my<file>?.pdf")).toBe("my_file__.pdf");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("builds an owner-scoped, unique key", () => {
    const a = storageKeyFor("user1", "notes.pdf");
    const b = storageKeyFor("user1", "notes.pdf");
    expect(a).toMatch(/^resources\/user1\/[0-9a-f-]{36}\/notes\.pdf$/);
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────
// Local disk provider
// ─────────────────────────────────────────────

describe("LocalDiskStorage", () => {
  let root = "";
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "tutor-walle-storage-"));
    storage = new LocalDiskStorage(root);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("round-trips put → get → delete", async () => {
    const key = storageKeyFor("u1", "file.pdf");
    await storage.put(key, PDF, "application/pdf");
    expect(Buffer.compare(await storage.get(key), PDF)).toBe(0);

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("treats a double delete as success", async () => {
    const key = storageKeyFor("u1", "again.pdf");
    await storage.put(key, PDF, "application/pdf");
    await storage.delete(key);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("refuses keys that escape the storage root", async () => {
    await expect(storage.get("../escape.pdf")).rejects.toBeInstanceOf(StorageError);
    await expect(storage.get("a/../../escape.pdf")).rejects.toBeInstanceOf(StorageError);
  });

  it("surfaces a write failure as a 503 StorageError", async () => {
    // Point the provider's root at a regular file so mkdir/write cannot succeed.
    const blocker = path.join(root, "not-a-directory");
    await fs.writeFile(blocker, "x");
    const broken = new LocalDiskStorage(blocker);
    await expect(broken.put("a/b.pdf", PDF, "application/pdf")).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

// ─────────────────────────────────────────────
// S3-compatible provider (signing only; no network)
// ─────────────────────────────────────────────

interface S3Call {
  url: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init: any;
}

function s3With(
  fetchImpl: (url: string, init: unknown) => Promise<Response>,
  usePathStyle = true,
): S3Storage {
  return new S3Storage({
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    bucket: "studentos",
    usePathStyle,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe("S3Storage", () => {
  it("signs a PUT with AWS Signature V4 and the real payload hash", async () => {
    const calls: S3Call[] = [];
    const s3 = s3With(async (url, init) => {
      calls.push({ url, init });
      return new Response("", { status: 200 });
    });

    await s3.put("resources/u1/abc/report.pdf", PDF, "application/pdf");

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://s3.example.com/studentos/resources/u1/abc/report.pdf");
    expect(init.method).toBe("PUT");
    expect(init.headers["x-amz-date"]).toBe("20260102T030405Z");
    expect(init.headers["x-amz-content-sha256"]).toBe(
      crypto.createHash("sha256").update(PDF).digest("hex"),
    );
    expect(init.headers["Content-Type"]).toBe("application/pdf");
    expect(init.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("uses virtual-hosted style when path style is disabled and returns bytes on get", async () => {
    const calls: S3Call[] = [];
    const s3 = s3With(async (url) => {
      calls.push({ url, init: {} });
      return new Response(new Uint8Array(PDF), { status: 200 });
    }, false);

    const body = await s3.get("k/file.pdf");
    expect(calls[0].url).toBe("https://studentos.s3.example.com/k/file.pdf");
    expect(Buffer.compare(body, PDF)).toBe(0);
  });

  it("maps a provider 404 to a 404 StorageError and a 500 to 503", async () => {
    const notFound = s3With(async () => new Response("", { status: 404 }));
    await expect(notFound.get("missing")).rejects.toMatchObject({ statusCode: 404 });

    const broken = s3With(async () => new Response("", { status: 500 }));
    await expect(broken.put("x", PDF, "application/pdf")).rejects.toMatchObject({ statusCode: 503 });
  });
});
