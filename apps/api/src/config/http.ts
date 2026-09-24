import {
  type Request,
  type Response,
  type NextFunction,
} from "express";

import { config } from "@/config";

// ─────────────────────────────
// Request ID
// ─────────────────────────────

let requestIdCounter = 0;

function nextRequestId(): string {
  return `req_${++requestIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────
// Request logging middleware
// ─────────────────────────────

/**
 * Attaches a unique request ID to every request and logs the method + path.
 * In production we log request IDs to help trace errors across the stack.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const id = (req as any).requestId = nextRequestId();
  const start = Date.now();

  // Log the incoming request (quiet in production unless there's an error).
  if (config.isDevelopment) {
    console.log(`[${id}] ${req.method} ${req.originalUrl} ${req.ip}`);
  }

  // Log the response when the response finishes (we hook into res).
  // We override `res.on` to capture finish/close events without touching
  // the rest of the response pipeline.
  const originalFinish = (req as any)._originalResFinish;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    if (config.isDevelopment || level === "error" || level === "warn") {
      console.log(`[${id}] ${req.method} ${req.originalUrl} ${status} ${duration}ms`);
    }
  });

  next();
}

// ─────────────────────────────
// Not-found handler (404)
// ─────────────────────────────

/**
 * Mounted after all routes — catches requests that didn't match any route.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
}

// ─────────────────────────────
// Global error handler
// ─────────────────────────────

/**
 * The Express error-handling middleware (4 arguments = error handler).
 *
 * Catches:
 *  - ApiError instances (mapped to structured error codes)
 *  - Prisma known errors (constraint violations, connection issues)
 *  - Zod validation errors
 *  - Unexpected errors (logged, returns INTERNAL_ERROR)
 */
export function globalErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof ZodError) {
    const fields = (error as ZodError).errors.map((e) => e.path.join(".")).filter(Boolean);
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `Validation failed${fields.length ? ` on: ${fields.join(", ")}` : ""}`,
      },
    });
    return;
  }

  // Prisma known errors.
  if (isPrismaKnownError(error)) {
    const code = mapPrismaToErrorCode(error);
    res.status(400).json({
      success: false,
      error: { code, message: error instanceof Error ? error.message : "Database error" },
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error";

  // Log to console in development; in production we'd push to a real logger.
  console.error("Unhandled error:", error instanceof Error ? error : new Error(message));

  res.status(500).json({
    success: false,
    error: {
      code: config.isProduction ? "INTERNAL_ERROR" : "INTERNAL_ERROR_DEV",
      message: config.isProduction ? "An unexpected error occurred" : message,
    },
  });
}

// ─────────────────────────────
// Prisma error classification
// ─────────────────────────────

/**
 * Determine whether an error is a known Prisma error we can map cleanly.
 */
function isPrismaKnownError(error: unknown): boolean {
  // Prisma throws PrismaClientKnownRequestError for query-level issues.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as any).code === "string" &&
    (error as any).code?.startsWith("P2") // P2000–P2099 known request errors
  );
}

/**
 * Map a Prisma error code to our error code space.
 */
function mapPrismaToErrorCode(error: unknown): string {
  const code = (error as any).code as string;
  switch (code) {
    case "P2002": // Unique constraint violation
      return "DUPLICATE_VALUE";
    case "P2025": // Record not found (delete/update on missing record)
      return "NOT_FOUND";
    case "P2003": // Foreign key violation
      return "FOREIGN_KEY_VIOLATION";
    case "P2007": // Foreign key constraint self-referencing
      return "FOREIGN_KEY_VIOLATION";
    default:
      return "DATABASE_ERROR";
  }
}

// ─────────────────────────────
// Imports (hoisted to top in real files; kept here for the patch below)
// ─────────────────────────────

import { ZodError } from "zod";
import { ApiError } from "./errors";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
