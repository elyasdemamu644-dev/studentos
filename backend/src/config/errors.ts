// Custom error classes so the rest of the app throws typed errors and the
// error-handling middleware can map them to the right HTTP status + error code.

import { ERROR_CODES } from "@studentos/shared/schemas/api";

// Base API error — all other API errors extend this so the middleware can
// distinguish application errors from programming bugs.
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    // Ensure correct prototype chain so instanceof works after transpilation.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Alias used by the global error handler. */
  get status(): number {
    return this.statusCode;
  }
}

// Convenience constructors for each standard error type (blueprint §40).
export function validationError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
}

export function unauthorizedError(message = "Authentication required"): ApiError {
  return new ApiError(401, ERROR_CODES.UNAUTHORIZED, message);
}

export function forbiddenError(message = "You do not have permission to perform this action"): ApiError {
  return new ApiError(403, ERROR_CODES.FORBIDDEN, message);
}

export function notFoundError(message = "Resource not found"): ApiError {
  return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
}

export function conflictError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(409, ERROR_CODES.CONFLICT, message, details);
}

export function unprocessableError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(422, ERROR_CODES.UNPROCESSABLE, message, details);
}

export function rateLimitError(message = "Too many requests, please try again later"): ApiError {
  return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
}

// For wrapping Prisma/known errors that don't fit the above.
export function internalError(message = "An internal error occurred"): ApiError {
  return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message);
}

// 503 — thrown when an optional integration is not configured (e.g. Google OAuth
// enabled at runtime but GOOGLE_CLIENT_ID missing).
export function serviceUnavailableError(message = "Service is not configured"): ApiError {
  return new ApiError(503, "SERVICE_UNAVAILABLE", message);
}

// 503 (default) — thrown when the file-storage provider fails (disk write,
// S3 non-2xx, network). A 404 variant is used when the record exists but its
// stored object is gone. The underlying provider error is never leaked.
export class StorageError extends ApiError {
  constructor(message: string, statusCode = 503, code: string = "STORAGE_ERROR") {
    super(statusCode, code, message);
    this.name = "StorageError";
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

// 503 — thrown when email dispatch is not configured (EMAIL_ENABLED false or
// SMTP_HOST missing). Kept distinct from SERVICE_UNAVAILABLE so clients can
// tell "feature off" apart from "integration broken".
export class EmailNotConfiguredError extends ApiError {
  constructor(message = "Email dispatch is not configured on this server") {
    super(503, "EMAIL_NOT_CONFIGURED", message);
    this.name = "EmailNotConfiguredError";
    Object.setPrototypeOf(this, EmailNotConfiguredError.prototype);
  }
}

// 502 — thrown when the SMTP provider refuses or cannot reach the message
// (non-2xx reply, connection failure). The underlying provider text is never
// leaked to the client.
export class EmailProviderError extends ApiError {
  constructor(message = "The email provider rejected the message") {
    super(502, "EMAIL_PROVIDER_ERROR", message);
    this.name = "EmailProviderError";
    Object.setPrototypeOf(this, EmailProviderError.prototype);
  }
}

// 504 — thrown when the SMTP conversation exceeds the configured timeout
// without completing. Distinct from provider rejection so operators can tune
// EMAIL_TIMEOUT_MS without masking real failures.
export class EmailTimeoutError extends ApiError {
  constructor(message = "The email provider did not respond in time") {
    super(504, "EMAIL_TIMEOUT", message);
    this.name = "EmailTimeoutError";
    Object.setPrototypeOf(this, EmailTimeoutError.prototype);
  }
}

// A "not found" that is also clearly a 404 for resource lookups.
export class NotFoundError extends ApiError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with id '${identifier}' not found`
      : `${resource} not found`;
    super(404, ERROR_CODES.NOT_FOUND, message);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

// Thrown when authorization fails on a specific resource ownership check.
export class ForbiddenResourceError extends ApiError {
  constructor(resource: string, identifier: string) {
    super(
      403,
      ERROR_CODES.FORBIDDEN,
      `${resource} '${identifier}' does not belong to the current user`,
    );
    this.name = "ForbiddenResourceError";
    Object.setPrototypeOf(this, ForbiddenResourceError.prototype);
  }
}

// 409 — thrown when an operation would create a duplicate/conflicting resource.
export class ConflictError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, ERROR_CODES.CONFLICT, message, details);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

// 400 — thrown when request data is semantically invalid (beyond Zod shape checks).
export class ValidationApiError extends ApiError {
  constructor(message: string, code: string = ERROR_CODES.VALIDATION_ERROR, details?: Record<string, unknown>) {
    super(400, code, message, details);
    this.name = "ValidationApiError";
    Object.setPrototypeOf(this, ValidationApiError.prototype);
  }
}

// 403 — thrown when a user isn't allowed to perform an operation.
export class ForbiddenError extends ApiError {
  constructor(resource: string, identifier?: string) {
    super(
      403,
      ERROR_CODES.FORBIDDEN,
      identifier ? `${resource} '${identifier}' access denied` : `Forbidden: ${resource}`,
    );
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}
