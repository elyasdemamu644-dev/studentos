import {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { ZodError } from "zod";

import { config } from "@/config";
import { ApiError } from "./errors";

// ─────────────────────────────
// Request ID
// ─────────────────────────────

let requestIdCounter = 0;

function nextRequestId(): string {
  return `req_${++requestIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────
// Error envelope
// ─────────────────────────────

/**
 * The single error body shape used by every failure path — routes, the
 * not-found handler and the global handler all produce exactly this:
 *
 *   { success: false, error: { code, message, details } }
 *
 * `details` is always present so clients can rely on it: a list of field
 * problems for validation failures, an object for application errors that
 * carry context, and `[]` when there is nothing further to say.
 */
function errorBody(code: string, message: string, details: unknown = []): {
  success: false;
  error: { code: string; message: string; details: unknown };
} {
  return { success: false, error: { code, message, details } };
}

// ─────────────────────────────
// Request logging middleware
// ─────────────────────────────

/**
 * Attaches a unique request ID to every request and logs the method + path.
 * The response line is always emitted for failures (4xx/5xx) and for every
 * response in development; successes are silent in production.
 *
 * Never logs bodies, query strings with credentials or the Authorization
 * header — only method, path, status and duration.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const id = ((req as unknown as Record<string, unknown>).requestId = nextRequestId());
  const start = Date.now();

  if (config.isDevelopment) {
    console.log(`[${id}] ${req.method} ${req.originalUrl} ${req.ip}`);
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    if (config.isDevelopment || level === "error" || level === "warn") {
      const line = `[${id}] ${req.method} ${req.originalUrl} ${status} ${duration}ms`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
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
  res.status(404).json(
    errorBody("NOT_FOUND", `Cannot ${req.method} ${req.originalUrl}`),
  );
}

// ─────────────────────────────
// Global error handler
// ─────────────────────────────

/**
 * The Express error-handling middleware (4 arguments = error handler).
 *
 * Distinctions it makes:
 *  - ApiError          → its own status + code (validation, auth, authz,
 *                        not-found, conflict, rate-limit … as constructed)
 *  - ZodError          → 400 VALIDATION_ERROR with a per-field `details` list
 *  - body-parser       → 400 INVALID_JSON / PAYLOAD_TOO_LARGE
 *  - Prisma P2xxx      → 404/400/409 with a fixed, safe message (the raw
 *                        Prisma text goes to the log, never to the client)
 *  - anything else     → 500 INTERNAL_ERROR, logged with stack
 *
 * Stack traces, Prisma internals, secrets and raw messages never leave the
 * process, in any environment.
 */
export function globalErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = (req as unknown as Record<string, unknown>).requestId as string | undefined;
  const at = `${req.method} ${req.originalUrl}${requestId ? ` [${requestId}]` : ""}`;

  if (error instanceof ApiError) {
    // 5xx from a typed error is still a server fault — always log it.
    if (error.statusCode >= 500) {
      console.error(`[${requestId ?? "-"}] ApiError ${error.statusCode} ${error.code} at ${at}: ${error.message}`);
    }
    res.status(error.status).json(errorBody(error.code, error.message, error.details ?? []));
    return;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));
    const fields = details.map((d) => d.path).filter(Boolean);
    res.status(400).json(
      errorBody(
        "VALIDATION_ERROR",
        `Validation failed${fields.length ? ` on: ${fields.join(", ")}` : ""}`,
        details,
      ),
    );
    return;
  }

  // Body-parser rejects malformed or oversized payloads before any route runs.
  // Those are client mistakes, so they must not surface as 500s.
  if (isBodyParserError(error)) {
    res.status(400).json(
      errorBody(
        error.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
        error.type === "entity.too.large"
          ? "Request body is too large"
          : "Request body is not valid JSON",
      ),
    );
    return;
  }

  // Prisma known errors — a database failure or a constraint the app did not
  // guard against. The raw message quotes column names, constraint names,
  // submitted values and even the source line that failed, so it is never
  // returned to a client in any environment — only written to the log.
  if (isPrismaKnownError(error)) {
    const prismaCode = (error as { code: string }).code;
    const { status, code } = mapPrismaError(error);
    console.error(
      `[${requestId ?? "-"}] Prisma ${prismaCode} -> ${status} ${code} at ${at}:`,
      error instanceof Error ? error.message : error,
    );
    res.status(status).json(errorBody(code, defaultMessageFor(code)));
    return;
  }

  // Unexpected error: log the stack server-side, never return it.
  if (error instanceof Error) {
    console.error(`[${requestId ?? "-"}] Unhandled error at ${at}:`, error.stack ?? error.message);
  } else {
    console.error(`[${requestId ?? "-"}] Unhandled non-Error at ${at}:`, error);
  }

  res.status(500).json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"));
}

function defaultMessageFor(code: string): string {
  switch (code) {
    case "VALIDATION_ERROR": return "Invalid request payload";
    case "NOT_FOUND": return "Resource not found";
    case "CONFLICT": return "Conflicting resource state";
    case "FOREIGN_KEY_VIOLATION": return "Referenced resource does not exist";
    case "DATABASE_ERROR": return "Database error";
    default: return "An unexpected error occurred";
  }
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
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("P2") // P2000–P2099 known request errors
  );
}

/** A body-parser failure (malformed JSON, oversized payload, bad encoding). */
interface BodyParserError {
  type: string;
}

/**
 * body-parser tags its errors with a `type` field (e.g. "entity.parse.failed",
 * "entity.too.large"), which is how we tell them apart from real faults.
 */
function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof (error as { type?: unknown }).type === "string" &&
    (error as { type: string }).type.startsWith("entity.")
  );
}

/**
 * Map a Prisma error onto the API's status/code space.
 *
 * Constraint violations follow the same codes the services throw by hand:
 * duplicates are conflicts, missing records are 404s, malformed identifiers
 * are validation failures.
 */
function mapPrismaError(error: unknown): { status: number; code: string } {
  switch ((error as { code: string }).code) {
    case "P2002": // Unique constraint violation — duplicate create
      return { status: 409, code: "CONFLICT" };
    case "P2025": // Record does not exist (update/delete on a missing record)
      return { status: 404, code: "NOT_FOUND" };
    case "P2023": // Malformed identifier (e.g. a non-CUID passed as `:id`)
      return { status: 400, code: "VALIDATION_ERROR" };
    case "P2003": // Foreign key violation
    case "P2007": // Foreign key constraint self-referencing
      return { status: 400, code: "FOREIGN_KEY_VIOLATION" };
    default:
      return { status: 400, code: "DATABASE_ERROR" };
  }
}
