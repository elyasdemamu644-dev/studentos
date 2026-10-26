import { z } from "zod";

/**
 * How a resource should be presented in the reader.
 *
 * The classifier is shared by the API and the web app so a file cannot be
 * treated as one kind on upload and a different kind in the viewer. It only
 * describes presentation: access control and byte retrieval stay on the API.
 */
export const resourceViewerKindSchema = z.enum([
  "pdf",
  "docx",
  "pptx",
  "spreadsheet",
  "image",
  "audio",
  "video",
  "markdown",
  "text",
  "link",
  "archive",
  "unsupported",
]);

export type ResourceViewerKind = z.infer<typeof resourceViewerKindSchema>;

export interface ResourceClassificationInput {
  storageType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  resourceType?: string | null;
  url?: string | null;
}

export interface ResourceClassification {
  kind: ResourceViewerKind;
  /** Human-facing label for the type ("PDF", "Word document", ...). */
  label: string;
  /** Whether the API may serve these bytes for direct in-browser rendering. */
  inlineSafe: boolean;
  /** Whether the AI attachment pipeline can actually read the contents. */
  aiReadable: boolean;
  /** Why an unsupported resource cannot be previewed, for an honest UI. */
  reason: string | null;
  /** Canonical MIME type to use when the bytes are served inline. */
  contentType: string | null;
}

const OOXML_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OOXML_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const LEGACY_DOC = "application/msword";
const LEGACY_PPT = "application/vnd.ms-powerpoint";
const LEGACY_XLS = "application/vnd.ms-excel";

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
  "text/html",
  "application/xhtml+xml",
  "text/css",
  "text/javascript",
  "application/javascript",
  "text/x-python",
  "text/x-java-source",
  "text/x-c",
  "text/x-c++",
  "text/x-shellscript",
]);

const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"]);

const AI_READABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const INLINE_IMAGE_TYPES = new Set([
  ...AI_READABLE_IMAGE_TYPES,
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "image/tiff",
  "image/x-icon",
]);

const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
]);

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/ogg",
  weba: "audio/webm",
};

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  m4v: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
};

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

/**
 * Upload sniffing stores media it cannot inspect as
 * `application/octet-stream`. In that case the filename is the only reliable
 * hint, and the response must still carry a playable Content-Type or the
 * browser's audio/video element will refuse the blob.
 */
function mediaContentType(
  mime: string,
  ext: string,
  knownMimeTypes: Set<string>,
  mimeByExtension: Record<string, string>,
  fallback: string,
  prefix: string,
): string {
  if (knownMimeTypes.has(mime) || mime.startsWith(prefix)) return mime;
  return mimeByExtension[ext] ?? fallback;
}

function normaliseMime(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().split(";")[0].trim();
}

function extensionOf(fileName: string | null | undefined): string {
  const name = (fileName ?? "").trim().toLowerCase();
  const match = /\.([a-z0-9]+)$/.exec(name);
  return match ? match[1] : "";
}

function unsupported(
  label: string,
  reason: string,
  aiReadable = false,
): ResourceClassification {
  return {
    kind: "unsupported",
    label,
    inlineSafe: false,
    aiReadable,
    reason,
    contentType: "application/octet-stream",
  };
}

/**
 * Classify a stored resource for the reader.
 *
 * URL resources always use the link reader; the bytes behind an external URL
 * are not fetched or proxied by this app. Uploaded files are classified from
 * their stored MIME type first, with the filename used for container formats
 * (`application/zip` / `application/octet-stream`) where the MIME alone cannot
 * identify the document kind.
 */
export function classifyResourceViewer(
  input: ResourceClassificationInput,
): ResourceClassification {
  if ((input.storageType ?? "").toUpperCase() === "URL" || (!input.storageType && input.url)) {
    return {
      kind: "link",
      label: "Web link",
      inlineSafe: false,
      aiReadable: true,
      reason: null,
      contentType: null,
    };
  }

  const mime = normaliseMime(input.mimeType);
  const ext = extensionOf(input.fileName);

  if (mime === "application/pdf" || ext === "pdf") {
    return {
      kind: "pdf",
      label: "PDF",
      inlineSafe: true,
      aiReadable: true,
      reason: null,
      contentType: "application/pdf",
    };
  }

  if (mime === OOXML_DOCX || ext === "docx") {
    return {
      kind: "docx",
      label: "Word document",
      inlineSafe: false,
      aiReadable: true,
      reason: null,
      contentType: OOXML_DOCX,
    };
  }

  if (mime === OOXML_PPTX || ext === "pptx") {
    return {
      kind: "pptx",
      label: "Presentation",
      inlineSafe: false,
      aiReadable: true,
      reason: null,
      contentType: OOXML_PPTX,
    };
  }

  if (mime === OOXML_XLSX || mime === LEGACY_XLS || ext === "xlsx" || ext === "xls") {
    return {
      kind: "spreadsheet",
      label: "Spreadsheet",
      inlineSafe: false,
      aiReadable: true,
      reason: null,
      contentType: mime === LEGACY_XLS || ext === "xls" ? LEGACY_XLS : OOXML_XLSX,
    };
  }

  if (mime === LEGACY_DOC || ext === "doc") {
    return unsupported(
      "Legacy Word document",
      "Legacy .doc files cannot be previewed in the browser. Download the file and open it in Word or LibreOffice.",
    );
  }

  if (mime === LEGACY_PPT || ext === "ppt") {
    return unsupported(
      "Legacy presentation",
      "Legacy .ppt files cannot be previewed in the browser. Download the file and open it in PowerPoint or LibreOffice.",
    );
  }

  if (mime === "text/csv" || mime === "application/csv" || ext === "csv") {
    return {
      kind: "spreadsheet",
      label: "CSV spreadsheet",
      inlineSafe: false,
      aiReadable: true,
      reason: null,
      contentType: "text/csv",
    };
  }

  if (MARKDOWN_MIME_TYPES.has(mime) || ext === "md" || ext === "markdown") {
    return {
      kind: "markdown",
      label: "Markdown",
      inlineSafe: true,
      aiReadable: true,
      reason: null,
      contentType: "text/markdown; charset=utf-8",
    };
  }

  if (TEXT_MIME_TYPES.has(mime) || ext === "txt" || ext === "log") {
    return {
      kind: "text",
      label: mime === "text/html" || ext === "html" ? "HTML file" : "Text file",
      inlineSafe: true,
      // HTML/JSON/XML/CSS are shown as source text but are not supported by the
      // document extraction pipeline, so the AI cannot read them as documents.
      aiReadable: mime === "text/plain" || mime === "text/csv" || ext === "txt",
      reason: null,
      contentType: "text/plain; charset=utf-8",
    };
  }

  if (INLINE_IMAGE_TYPES.has(mime) || mime.startsWith("image/") || isImageExtension(ext)) {
    return {
      kind: "image",
      label: "Image",
      inlineSafe: true,
      aiReadable: AI_READABLE_IMAGE_TYPES.has(mime),
      reason: null,
      contentType: mediaContentType(
        mime,
        ext,
        INLINE_IMAGE_TYPES,
        IMAGE_MIME_BY_EXTENSION,
        "image/*",
        "image/",
      ),
    };
  }

  if (AUDIO_MIME_TYPES.has(mime) || mime.startsWith("audio/") || isAudioExtension(ext)) {
    return {
      kind: "audio",
      label: "Audio",
      inlineSafe: true,
      aiReadable: false,
      reason: null,
      contentType: mediaContentType(
        mime,
        ext,
        AUDIO_MIME_TYPES,
        AUDIO_MIME_BY_EXTENSION,
        "audio/mpeg",
        "audio/",
      ),
    };
  }

  if (VIDEO_MIME_TYPES.has(mime) || mime.startsWith("video/") || isVideoExtension(ext)) {
    return {
      kind: "video",
      label: "Video",
      inlineSafe: true,
      aiReadable: false,
      reason: null,
      contentType: mediaContentType(
        mime,
        ext,
        VIDEO_MIME_TYPES,
        VIDEO_MIME_BY_EXTENSION,
        "video/mp4",
        "video/",
      ),
    };
  }

  if (ARCHIVE_MIME_TYPES.has(mime) || isArchiveExtension(ext)) {
    if (mime === "application/zip" || mime === "application/x-zip-compressed" || ext === "zip") {
      return {
        kind: "archive",
        label: "ZIP archive",
        inlineSafe: false,
        aiReadable: false,
        reason: null,
        contentType: "application/zip",
      };
    }
    return unsupported(
      "Archive",
      "This archive format cannot be listed in the browser. Download the file and open it with an archive tool.",
    );
  }

  return unsupported(
    "File",
    "This file type has no in-browser preview yet. Download the file to open it on your device.",
  );
}

/** The content type the API should send when serving a file for the viewer. */
export function viewerContentType(classification: ResourceClassification): string {
  return classification.contentType ?? "application/octet-stream";
}

/** Whether the AI can read the resource's contents (text, slides, sheets or image). */
export function isResourceAiReadable(input: ResourceClassificationInput): boolean {
  return classifyResourceViewer(input).aiReadable;
}

function isImageExtension(ext: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "tif", "tiff", "ico"].includes(ext);
}

function isAudioExtension(ext: string): boolean {
  return ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "weba"].includes(ext);
}

function isVideoExtension(ext: string): boolean {
  return ["mp4", "webm", "ogv", "mov", "avi", "mkv", "m4v", "mpeg", "mpg"].includes(ext);
}

function isArchiveExtension(ext: string): boolean {
  return ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext);
}
