// ─────────────────────────────────────────────────────────────────────
// File upload validation.
//
// The client-declared MIME type (the multipart part's Content-Type) is NEVER
// trusted on its own: the bytes are sniffed first, and the *sniffed* type must
// be on the operator's allowlist. For the container formats whose magic bytes
// cannot identify the exact subtype (OOXML / legacy OLE office documents) the
// declared type is only accepted when it is one of the known subtypes AND is
// on the allowlist — a text file renamed to `.docx` still fails.
// ─────────────────────────────────────────────────────────────────────

import { ValidationApiError } from "@/config/errors";

// ─────────────────────────────────────────────
// Error codes (upload-specific; see docs/api/openapi.yaml)
// ─────────────────────────────────────────────

export const UPLOAD_ERROR_CODES = {
  MISSING_FILE: "MISSING_FILE",
  EMPTY_FILE: "EMPTY_FILE",
  INVALID_FILE_NAME: "INVALID_FILE_NAME",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  INVALID_MULTIPART: "INVALID_MULTIPART",
  RESOURCE_NOT_A_FILE: "RESOURCE_NOT_A_FILE",
} as const;

// ─────────────────────────────────────────────
// MIME fingerprints
// ─────────────────────────────────────────────

/** A magic prefix that identifies a container/family. */
interface Magic {
  readonly type: string;
  readonly bytes: readonly number[];
  readonly offset?: number;
}

const OOXML_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const OLE_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
]);

const SIGNATURES: readonly Magic[] = [
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { type: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK.. (OOXML/zip)
  { type: "application/zip", bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty zip
  { type: "application/x-ole-storage", bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

function startsWithBytes(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Sniff the content type from the leading bytes.
 *
 * Returns a concrete MIME type, a container marker (`application/zip`,
 * `application/x-ole-storage`) or `text/plain` when the bytes look like
 * printable text. Returns `null` when nothing matches — the caller must reject
 * unknown binary content.
 */
export function detectMimeType(buffer: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (startsWithBytes(buffer, signature.bytes, signature.offset ?? 0)) {
      return signature.type;
    }
  }
  if (looksLikeText(buffer)) return "text/plain";
  return null;
}

/** Printable-ASCII / UTF-8 heuristics: no NUL and no control bytes. */
function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, 4096);
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) return false;
  }
  return true;
}

/**
 * Decide the canonical MIME type to store, given the client-declared type, the
 * sniffed type and the operator allowlist. `allowAnyType` is reserved for AI
 * attachments: known content is still sniffed and unknown binaries are stored
 * as `application/octet-stream`. Throws 400 `UNSUPPORTED_FILE_TYPE` when the
 * content is unknown or not permitted by the selected policy.
 */
export function resolveUploadMimeType(
  declaredMime: string,
  detected: string | null,
  allowed: ReadonlySet<string>,
  allowAnyType = false,
): string {
  const declared = (declaredMime || "").toLowerCase().split(";")[0].trim();
  const unsupported = (): never => {
    throw new ValidationApiError(
      "This file type is not allowed. Allowed types: " +
        Array.from(allowed).sort().join(", "),
      UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  };

  if (!detected) {
    if (allowAnyType) return "application/octet-stream";
    return unsupported();
  }

  // OOXML (docx/pptx/xlsx) is a ZIP container; the exact subtype comes from the
  // client but must be a known subtype and explicitly allowed.
  if (detected === "application/zip") {
    if (OOXML_TYPES.has(declared) && (allowAnyType || allowed.has(declared))) return declared;
    if (allowAnyType) return detected;
    return unsupported();
  }

  // Legacy MS Office files share the OLE2 compound-file magic.
  if (detected === "application/x-ole-storage") {
    if (OLE_TYPES.has(declared) && (allowAnyType || allowed.has(declared))) return declared;
    if (allowAnyType) return detected;
    return unsupported();
  }

  // Concrete detection wins over whatever the client claimed.
  if (allowAnyType) return detected;
  if (!allowed.has(detected)) return unsupported();
  return detected;
}

// ─────────────────────────────────────────────
// Filename policy
// ─────────────────────────────────────────────

/**
 * Validate the *original* filename from the multipart part. Rejects rather
 * than silently rewriting so a client cannot smuggle a path-looking name into
 * logs or a `Content-Disposition` header. Returns the trimmed original.
 */
export function assertValidFileName(rawName: string): string {
  const name = (rawName ?? "").trim();
  const invalid = (reason: string): never => {
    throw new ValidationApiError(
      `Invalid file name: ${reason}`,
      UPLOAD_ERROR_CODES.INVALID_FILE_NAME,
    );
  };

  if (!name) invalid("an empty name is not allowed");
  if (name.length > 255) invalid("the name is longer than 255 characters");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) invalid("control characters are not allowed");
  if (/[\\/]/.test(name)) invalid("path separators are not allowed");
  if (name === "." || name === "..") invalid("the name is not a real file name");
  return name;
}

/**
 * Reduce a name to a safe storage-key segment and Content-Disposition value.
 * Keeps letters, digits, spaces and a few punctuation marks; everything else
 * becomes `_`. Collapses traversal sequences and trims Windows-hostile edges.
 * Always returns a non-empty string.
 */
export function sanitizeFileName(rawName: string): string {
  const base = (rawName ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}\s._\-()]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");

  const bounded = cleaned.length > 200 ? cleaned.slice(cleaned.length - 200) : cleaned;
  return bounded || "file";
}
