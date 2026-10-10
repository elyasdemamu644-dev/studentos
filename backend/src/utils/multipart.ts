// ─────────────────────────────────────────────────────────────────────
// Dependency-free multipart/form-data parsing.
//
// Node's global `Request`/`FormData` (undici) already implement a hardened
// multipart parser, so the incoming Node stream is bridged with
// `Readable.toWeb` and piped through a byte-counting `TransformStream` first.
// The counter is the real memory guard: it errors the stream (and therefore
// `formData()`) the moment the request exceeds the configured budget, so an
// oversized upload can never be fully buffered.
// ─────────────────────────────────────────────────────────────────────

import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";

import { ValidationApiError } from "@/config/errors";
import { UPLOAD_ERROR_CODES } from "@/utils/file-validation";

/**
 * Extra bytes allowed on top of the file limit for the multipart boundaries,
 * part headers and small text fields. The precise file size is checked again
 * after parsing; this is only a ceiling on how much is ever buffered.
 */
export const MULTIPART_FRAMING_ALLOWANCE_BYTES = 1024 * 1024; // 1 MB

class FileTooLargeError extends Error {}

/**
 * Wrap a byte stream with a running total that errors once `maxBytes` is
 * exceeded. `pull` reads one chunk at a time, so an oversized body is rejected
 * before the whole thing is ever held in memory.
 */
function limitStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let total = 0;
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        controller.error(new FileTooLargeError("Upload exceeds the configured limit"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export interface ParsedFile {
  buffer: Buffer;
  originalName: string;
  declaredMime: string;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  file: ParsedFile | null;
}

function isMultipart(contentType: string | undefined): boolean {
  return (contentType ?? "").toLowerCase().startsWith("multipart/form-data");
}

/**
 * Parse a multipart request into its text fields and (optionally) the single
 * `file` part. Throws typed 400s for malformed bodies and oversized files.
 */
export async function parseMultipart(
  req: IncomingMessage,
  maxFileBytes: number,
): Promise<ParsedMultipart> {
  if (!isMultipart(req.headers["content-type"])) {
    throw new ValidationApiError(
      "Expected a multipart/form-data request",
      UPLOAD_ERROR_CODES.INVALID_MULTIPART,
    );
  }

  const bufferLimit = maxFileBytes + MULTIPART_FRAMING_ALLOWANCE_BYTES;
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > bufferLimit) {
    throw new ValidationApiError(
      "The uploaded file is too large",
      UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
    );
  }

  // The Node and DOM stream typings disagree on the chunk element type; at
  // runtime this is a plain byte stream.
  const source = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
  const body = limitStream(source, bufferLimit);

  let form: FormData;
  try {
    form = await new Request("http://localhost/upload", {
      method: "POST",
      // `duplex: "half"` is required when streaming a request body.
      headers: req.headers as Record<string, string>,
      body,
      duplex: "half",
    } as RequestInit).formData();
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      throw new ValidationApiError(
        "The uploaded file is too large",
        UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
      );
    }
    throw new ValidationApiError(
      "The multipart request body could not be parsed",
      UPLOAD_ERROR_CODES.INVALID_MULTIPART,
    );
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !(key in fields)) {
      fields[key] = value;
    }
  }

  const entry = form.get("file");
  if (entry === null) return { fields, file: null };
  if (typeof entry === "string") {
    throw new ValidationApiError(
      "The `file` field must be a file, not a text value",
      UPLOAD_ERROR_CODES.INVALID_MULTIPART,
    );
  }

  if (entry.size === 0) {
    throw new ValidationApiError("The uploaded file is empty", UPLOAD_ERROR_CODES.EMPTY_FILE);
  }
  if (entry.size > maxFileBytes) {
    throw new ValidationApiError(
      "The uploaded file is too large",
      UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
    );
  }

  const buffer = Buffer.from(await entry.arrayBuffer());
  return {
    fields,
    file: {
      buffer,
      originalName: entry.name || "file",
      declaredMime: entry.type || "application/octet-stream",
    },
  };
}
