// ─────────────────────────────────────────────
// API error model
// ─────────────────────────────────────────────
//
// Mirrors the backend envelope:
//   { success: false, error: { code, message, details? } }
//
// A dedicated class lets UI code branch on `error.code` and `error.status`
// without string matching in components.

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NetworkError extends ApiClientError {
  constructor(message = "Unable to reach the StudentOS server. Check your connection and try again.") {
    super(message, 0, "NETWORK_ERROR");
    this.name = "NetworkError";
  }
}

export class SessionExpiredError extends ApiClientError {
  constructor() {
    super("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

export function toClientError(error: unknown, fallbackMessage: string): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (error instanceof TypeError || error instanceof DOMException) {
    return new NetworkError();
  }
  return new ApiClientError(fallbackMessage, 500, "INTERNAL_ERROR");
}