// ─────────────────────────────────────────────────────────────────────
// Document text extraction.
// ─────────────────────────────────────────────────────────────────────
//
// Supported formats: PDF, DOCX, PPTX, XLSX/CSV, TXT, Markdown
// Returns extracted text with page/section boundaries where available.
// ─────────────────────────────────────────────────────────────────────

import { extractRawText } from "mammoth";

import { ApiError } from "@/config/errors";

// pdf-parse is ESM with poor types; use `any` to bypass TS checks
const pdfParse: any = (() => {
  try {
    const mod = require("pdf-parse");
    return mod.default ?? mod;
  } catch {
    return null;
  }
})();

// Dynamic import fallback for pdf-parse (ESM module)
let pdfParseFn: any = pdfParse;

async function getPdfParse(): Promise<any> {
  if (!pdfParseFn) {
    // Use require directly to avoid TS analyzing the ESM import
    const mod: any = require("pdf-parse");
    pdfParseFn = mod.default ?? mod;
  }
  return pdfParseFn!;
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
  }
}

/**
 * Extract text from a PDF buffer.
 * Returns pages with page numbers and combined full text.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedDocument> {
  try {
    const pdfParseFn = await getPdfParse();
    // @ts-ignore - pdf-parse types have issues with the options parameter
    const data = await pdfParseFn(buffer, {
      max: MAX_PAGES_TO_EXTRACT,
    });

    const pages: ExtractedPage[] = [];
    // pdf-parse doesn't provide per-page text directly in newer versions
    // We'll simulate pages by splitting on form feeds if present, or treat as single page
    const rawText = data.text;

    // Try to split by page breaks (form feed character)
    const pageTexts = rawText.split(/\f+/).filter((t) => t.trim().length > 0);

    if (pageTexts.length > 1) {
      pageTexts.forEach((text, index) => {
        pages.push({ pageNumber: index + 1, text: text.trim() });
      });
    } else {
      pages.push({ pageNumber: 1, text: rawText.trim() });
    }

    const fullText = pages.map((p) => p.text).join("\n\n");
    const truncated = truncateText(fullText);

    return {
      pages: pages.slice(0, MAX_PAGES_TO_EXTRACT),
      fullText: truncated,
      pageCount: Math.min(data.numpages, MAX_PAGES_TO_EXTRACT),
      charCount: truncated.length,
      format: "pdf",
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new DocumentExtractionError("Failed to extract text from PDF: " + (error as Error).message);
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
    // pptx is ESM with poor types; use dynamic require
    let pptxParse: any = null;
    try {
      pptxParse = require("pptxjs");
    } catch {
      throw new DocumentExtractionError("PPTX extraction library not available");
    }
    if (!pptxParse) {
      throw new DocumentExtractionError("PPTX extraction library not available");
    }

    const workbook = pptxParse.parse(buffer);
    const fullTexts: string[] = [];

    workbook.Slide.forEach((slide, slideIndex) => {
      const slideText: string[] = [];
      slide.Shapes.forEach((shape: any) => {
        if (shape.TextFrame && shape.TextFrame.Text) {
          slideText.push(shape.TextFrame.Text);
        }
      });
      fullTexts.push(`Slide ${slideIndex + 1}: ${slideText.join(" ")}`);
    });

    const rawText = fullTexts.join("\n\n");
    const truncated = truncateText(rawText);

    const pages: ExtractedPage[] = fullTexts.length > 0
      ? fullTexts.map((text, index) => ({ pageNumber: index + 1, text }))
      : [{ pageNumber: 1, text: "" }];

    return {
      pages: pages.slice(0, MAX_PAGES_TO_EXTRACT),
      fullText: truncated,
      pageCount: Math.min(workbook.Slide.length, MAX_PAGES_TO_EXTRACT),
      charCount: truncated.length,
      format: "pptx",
    };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("Failed to extract text from PPTX: " + (error as Error).message);
  }
}

/**
 * Extract text from an XLSX or CSV buffer.
 */
export async function extractXlsxText(buffer: Buffer, mimeType: string): Promise<ExtractedDocument> {
  try {
    let xlsxParse: any = null;
    try {
      xlsxParse = require("xlsx");
    } catch {
      throw new DocumentExtractionError("XLSX extraction library not available");
    }
    if (!xlsxParse) {
      throw new DocumentExtractionError("XLSX extraction library not available");
    }

    const workbook = xlsxParse.read(buffer, { type: "buffer" });

    // Handle CSV (single sheet)
    if (mimeType === "text/csv" || mimeType === "application/csv") {
      const rawText = workbook.SheetNames.length > 0 ? workbook.Sheets[workbook.SheetNames[0]] : {};
      const cellData: string[] = [];
      Object.values(rawText).forEach((row: any) => {
        row ? cellData.push(String(row)) : null;
      });
      const text = cellData.join("\n");
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
      const rows: any[] = [];
      for (const [cellAddr, cell] of Object.entries(sheet as any)) {
        if (cellAddr.endsWith("")) { // header row marker
          const rowVal = (cell as any).v ?? (cell as any).t ?? "";
          rows.push(String(rowVal));
        }
      }
      if (rows.length > 0) {
        sheetTexts.push(`Sheet: ${sheetName}\n${rows.join("\n")}`);
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
    case "text/csv":
      return extractXlsxText(buffer, mimeType);
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
 * Check if a MIME type is supported for text extraction.
 */
export function isExtractionSupported(mimeType: string): boolean {
  return [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "text/markdown",
  ].includes(mimeType);
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