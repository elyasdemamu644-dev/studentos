// ─────────────────────────────────────────────────────────────────────
// Document text extraction.
// ─────────────────────────────────────────────────────────────────────
//
// Supported formats: PDF, DOCX, PPTX, XLSX/CSV, TXT, Markdown
// Returns extracted text with page/section boundaries where available.
// ─────────────────────────────────────────────────────────────────────

import { extractRawText } from "mammoth";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { ApiError } from "@/config/errors";

// pdf-parse v2 is ESM-only. Loading it through `require` throws
// "require is not defined" under the ESM dev runner, so import it lazily.
type PdfParseModule = typeof import("pdf-parse");
let pdfParseModule: Promise<PdfParseModule> | null = null;

function getPdfParseModule(): Promise<PdfParseModule> {
  pdfParseModule ??= import("pdf-parse");
  return pdfParseModule;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
  fullText: string;
  pageCount: number;
  charCount: number;
  format: "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "txt" | "md";
}

// Configuration limits
const MAX_EXTRACTED_CHARS = 100_000; // ~100KB of text
const MAX_PAGES_TO_EXTRACT = 50;

/** Errors specific to document extraction. */
export class DocumentExtractionError extends ApiError {
  constructor(message: string, public readonly code: string = "EXTRACTION_FAILED") {
    super(400, code, message);
    this.name = "DocumentExtractionError";
    // The ApiError constructor resets the prototype to ApiError.prototype; restore
    // this subclass so `instanceof DocumentExtractionError` holds (as the other
    // ApiError subclasses do), letting callers degrade unreadable files safely.
    Object.setPrototypeOf(this, DocumentExtractionError.prototype);
  }
}

/**
 * Extract text from a PDF buffer.
 * Returns pages with page numbers and combined full text.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedDocument> {
  let parser: InstanceType<PdfParseModule["PDFParse"]> | null = null;
  try {
    const { PDFParse } = await getPdfParseModule();
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText({
      first: MAX_PAGES_TO_EXTRACT,
      pageJoiner: "",
    });

    const pages: ExtractedPage[] = result.pages
      .map((page) => ({
        pageNumber: page.num,
        text: page.text.trim(),
      }))
      .filter((page) => page.text.length > 0);
    if (pages.length === 0) {
      pages.push({ pageNumber: 1, text: "" });
    }

    const fullText = pages.map((page) => page.text).join("\n\n");
    const truncated = truncateText(fullText);

    return {
      pages: pages.slice(0, MAX_PAGES_TO_EXTRACT),
      fullText: truncated,
      pageCount: Math.min(result.total, MAX_PAGES_TO_EXTRACT),
      charCount: truncated.length,
      format: "pdf",
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new DocumentExtractionError("Failed to extract text from PDF: " + (error as Error).message);
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

/**
 * Extract text from a DOCX buffer using mammoth.
 */
export async function extractDocxText(buffer: Buffer): Promise<ExtractedDocument> {
  try {
    const result = await extractRawText({ buffer });
    const rawText = result.value;

    // Split by page breaks if present (mammoth uses \f for page breaks)
    const pageTexts = rawText.split(/\f+/).filter((t) => t.trim().length > 0);

    const pages: ExtractedPage[] = pageTexts.length > 0
      ? pageTexts.map((text, index) => ({ pageNumber: index + 1, text: text.trim() }))
      : [{ pageNumber: 1, text: rawText.trim() }];

    const fullText = pages.map((p) => p.text).join("\n\n");
    const truncated = truncateText(fullText);

    return {
      pages: pages.slice(0, MAX_PAGES_TO_EXTRACT),
      fullText: truncated,
      pageCount: pages.length,
      charCount: truncated.length,
      format: "docx",
    };
  } catch (error) {
    throw new DocumentExtractionError("Failed to extract text from DOCX: " + (error as Error).message);
  }
}

/**
 * Extract text from plain text or markdown files.
 */
export function extractTextText(buffer: Buffer, format: "txt" | "md"): ExtractedDocument {
  try {
    const rawText = buffer.toString("utf-8");

    // For markdown, we could optionally strip markdown syntax, but keep it for context
    const text = rawText.trim();

    // Split into "pages" by large gaps or just treat as single page
    const pages: ExtractedPage[] = [{ pageNumber: 1, text }];

    const fullText = text;
    const truncated = truncateText(fullText);

    return {
      pages,
      fullText: truncated,
      pageCount: 1,
      charCount: truncated.length,
      format,
    };
  } catch (error) {
    throw new DocumentExtractionError(`Failed to extract text from ${format.toUpperCase()}: ` + (error as Error).message);
  }
}

/**
 * Extract text from a PPTX (PowerPoint) buffer.
 */
export async function extractPptxText(buffer: Buffer): Promise<ExtractedDocument> {
  try {
    // A .pptx is an OOXML ZIP container: `ppt/slides/slideN.xml`. Reading the
    // text runs directly keeps the parser dependency-free (JSZip is already used
    // for archive inspection) and turns slide text on for the AI pipeline.
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
      .map((name) => ({ name, match: /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
      .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));

    if (slideNames.length === 0) {
      throw new DocumentExtractionError(
        "The presentation contains no readable slides",
        "EXTRACTION_FAILED",
      );
    }

    const pages: ExtractedPage[] = [];
    for (const [index, slide] of slideNames.slice(0, MAX_PAGES_TO_EXTRACT).entries()) {
      const file = zip.file(slide.name);
      if (!file) continue;
      const xml = await file.async("string");
      const texts: string[] = [];
      const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(xml)) !== null) {
        const text = decodeXmlEntities(match[1]).trim();
        if (text) texts.push(text);
      }
      pages.push({
        pageNumber: index + 1,
        text: texts.length > 0 ? `Slide ${index + 1}: ${texts.join(" ")}` : `Slide ${index + 1}:`,
      });
    }

    const fullText = pages.map((page) => page.text).join("\n\n");
    const truncated = truncateText(fullText);

    return {
      pages,
      fullText: truncated,
      pageCount: Math.min(slideNames.length, MAX_PAGES_TO_EXTRACT),
      charCount: truncated.length,
      format: "pptx",
    };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("Failed to extract text from PPTX: " + (error as Error).message);
  }
}

/** Decode the XML entities that can occur inside a slide's text runs. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/**
 * Extract text from a plain CSV buffer. CSV is plain text on disk, so it needs
 * no third-party parser and is always available — unlike XLSX/PPTX, whose
 * parsers are optional.
 */
export function extractCsvText(buffer: Buffer): ExtractedDocument {
  try {
    const raw = buffer.toString("utf-8").replace(/^\uFEFF/, "").trim();
    const truncated = truncateText(raw);
    return {
      pages: [{ pageNumber: 1, text: raw }],
      fullText: truncated,
      pageCount: 1,
      charCount: truncated.length,
      format: "csv",
    };
  } catch (error) {
    throw new DocumentExtractionError("Failed to extract text from CSV: " + (error as Error).message);
  }
}

/**
 * Extract text from an XLSX buffer.
 */
export async function extractXlsxText(buffer: Buffer, mimeType: string): Promise<ExtractedDocument> {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Render a sheet as text, one source row per line. `sheet_to_json` reads the
    // sheet's `!ref` range and returns cells in order; iterating the sheet
    // object directly also yielded the `!ref`/`!cols` metadata and visited
    // cells out of order.
    const sheetToText = (sheet: XLSX.WorkSheet): string => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      return rows
        .map((row) =>
          Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))).join(", ") : String(row),
        )
        .join("\n");
    };

    // Handle CSV (single sheet)
    if (mimeType === "text/csv" || mimeType === "application/csv") {
      const firstSheetName = workbook.SheetNames[0];
      const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
      const text = sheet ? sheetToText(sheet) : "";
      const truncated = truncateText(text);

      return {
        pages: [{ pageNumber: 1, text }],
        fullText: truncated,
        pageCount: 1,
        charCount: truncated.length,
        format: "csv",
      };
    }

    // Handle XLSX (multiple sheets)
    const sheetNames = workbook.SheetNames;
    const sheetTexts: string[] = [];

    sheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const rowsText = sheetToText(sheet);
      if (rowsText.trim().length > 0) {
        sheetTexts.push(`Sheet: ${sheetName}\n${rowsText}`);
      }
    });

    const rawText = sheetTexts.length > 0 ? sheetTexts.join("\n\n") : "";
    const truncated = truncateText(rawText);

    const pages: ExtractedPage[] = sheetTexts.length > 0
      ? sheetTexts.map((text, index) => ({ pageNumber: index + 1, text }))
      : [{ pageNumber: 1, text: "" }];

    return {
      pages: pages.slice(0, MAX_PAGES_TO_EXTRACT),
      fullText: truncated,
      pageCount: Math.min(sheetNames.length, MAX_PAGES_TO_EXTRACT),
      charCount: truncated.length,
      format: "xlsx",
    };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("Failed to extract text from XLSX/CSV: " + (error as Error).message);
  }
}

/**
 * Main entry point: extract text from a buffer based on MIME type.
 * Throws DocumentExtractionError for unsupported types or extraction failures.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedDocument> {
  if (buffer.length === 0) {
    throw new DocumentExtractionError("File is empty", "EMPTY_FILE");
  }

  // Enforce size limit before attempting extraction
  const maxExtractionSize = 10 * 1024 * 1024; // 10MB max for extraction
  if (buffer.length > maxExtractionSize) {
    throw new DocumentExtractionError(
      `File is too large for text extraction (max ${maxExtractionSize / 1024 / 1024}MB)`,
      "FILE_TOO_LARGE_FOR_EXTRACTION",
    );
  }

  switch (mimeType) {
    case "application/pdf":
      return extractPdfText(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocxText(buffer);
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptxText(buffer);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      return extractXlsxText(buffer, mimeType);
    case "text/csv":
    case "application/csv":
      return extractCsvText(buffer);
    case "text/plain":
      return extractTextText(buffer, "txt");
    case "text/markdown":
      return extractTextText(buffer, "md");
    default:
      throw new DocumentExtractionError(
        `Unsupported file type for text extraction: ${mimeType}`,
        "UNSUPPORTED_EXTRACTION_TYPE",
      );
  }
}

/**
 * Truncate text to MAX_EXTRACTED_CHARS with a clear marker.
 */
function truncateText(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return text.slice(0, MAX_EXTRACTED_CHARS) + `\n\n[... truncated: ${text.length - MAX_EXTRACTED_CHARS} more characters ...]`;
}

/**
 * Formats whose parser is bundled and therefore always available.
 */
const ALWAYS_SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "text/markdown",
]);

/**
 * Check if a MIME type is supported for text extraction.
 *
 * Every format reported here has a bundled parser. XLSX/PPTX used to be gated
 * on optional modules that were never installed, so the UI advertised them as
 * readable and then silently failed; both parsers are now dependencies.
 */
export function isExtractionSupported(mimeType: string): boolean {
  return ALWAYS_SUPPORTED_TYPES.has(mimeType);
}

/**
 * Get human-readable format name from MIME type.
 */
export function getFormatName(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "DOCX";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "PPTX";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
    case "text/csv":
      return "XLSX";
    case "text/plain":
      return "TXT";
    case "text/markdown":
      return "Markdown";
    default:
      return "Unknown";
  }
}