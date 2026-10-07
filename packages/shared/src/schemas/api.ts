// API response envelope — every endpoint uses this shape (blueprint §39).
//
// Success:
//   { success: true, data: <T>, meta?: { ... } }
//
// Error:
//   { success: false, error: { code: string, message: string, details?: unknown } }
//
// `details` is always emitted by the API (never absent): a list of field
// problems for VALIDATION_ERROR, an object for errors that carry context,
// and [] when there is nothing further to say.

export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// Standard error codes used across the API.
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNPROCESSABLE: "UNPROCESSABLE_ENTITY",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

// Pagination standard for list endpoints.
export type PaginationInput = {
  page?: number; // 1-indexed, default 1
  limit?: number; // default 20, max 100
};

export type PaginationOutput = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Sort + filter helpers for list queries.
export type SortDirection = "asc" | "desc";

export type SortField<T extends string> = T;

export type PaginatedRequest<T extends string> = PaginationInput & {
  sort?: SortField<T>;
  direction?: SortDirection;
  filter?: Record<string, string | number | boolean | null | undefined>;
};

// Health check response (blueprint §41).
export type HealthResponse = {
  status: "ok" | "degraded" | "down";
  database: "connected" | "disconnected";
  version: string;
};
