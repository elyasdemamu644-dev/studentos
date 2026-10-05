// ─────────────────────────────────────────────
// API client
// ─────────────────────────────────────────────
//
// The single transport used across the app. Components never call fetch
// directly. Responsibilities:
//   - base URL resolution (NEXT_PUBLIC_API_URL)
//   - attaching the bearer token
//   - envelope parsing + typed responses
//   - automatic token refresh on 401 with retry-once
//   - structured error mapping (ApiClientError / SessionExpiredError)

import { ApiClientError, NetworkError, SessionExpiredError } from "./errors";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "./auth-session";

export type { ApiClientError } from "./errors";

// Vercel service binding (injected at runtime in Vercel deployments)
// Falls back to NEXT_PUBLIC_API_URL for local development
const API_BASE_URL = (process.env.API_SERVICE_URL
  ? `${process.env.API_SERVICE_URL}/api/v1`
  : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1")
).replace(/\/$/, "");

const AUTH_PROBLEM_CODES = new Set(["AUTH_TOKEN_EXPIRED", "AUTH_INVALID_TOKEN"]);

let refreshInFlight: Promise<string | null> | null = null;

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

/** Generic success envelope without the `data` (for e.g. logout). */
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function attemptRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const json = (await res.json()) as Envelope<{
        accessToken: string;
        refreshToken: string;
      }>;
      if (!res.ok || !json.success || !json.data) {
        clearSession();
        return null;
      }
      setTokens(json.data.accessToken, json.data.refreshToken);
      return json.data.accessToken;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestInternal<T>(path, options, false);
}

async function requestInternal<T>(
  path: string,
  options: RequestOptions,
  wasRefreshed: boolean,
): Promise<T> {
  const { body, headers, ...rest } = options;
  const token = getAccessToken();

  const makeHeaders = (withAuth: boolean): HeadersInit => {
    const h = new Headers(headers);
    if (body !== undefined) h.set("Content-Type", "application/json");
    if (withAuth && token) h.set("Authorization", `Bearer ${token}`);
    return h;
  };

  const doFetch = async (withAuth: boolean): Promise<Response> => {
    try {
      return await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        headers: makeHeaders(withAuth),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      // A caller-driven abort (the chat's stop button) is not a network
      // failure. Propagate it so the UI can treat it as a cancellation
      // instead of an error the student has to retry.
      if (isAbortError(error)) throw error;
      throw new NetworkError();
    }
  };

  const respond = async (res: Response): Promise<T> => {
    let json: Envelope<T> | null = null;
    try {
      json = (await res.json()) as Envelope<T>;
    } catch {
      // Empty body is fine for some endpoints (204-ish).
    }

    if (res.status >= 200 && res.status < 300) {
      if (json && json.success === true) return json.data as T;
      if (!json) return undefined as T;
    }

    const error = json?.error;
    const code = error?.code ?? "UNKNOWN_ERROR";
    const message = error?.message ?? `Request failed (${res.status})`;

    if (res.status === 401 && AUTH_PROBLEM_CODES.has(code) && getRefreshToken() && !wasRefreshed) {
      const fresh = await attemptRefresh();
      if (fresh) {
        return requestInternal<T>(path, options, true);
      }
      throw new SessionExpiredError();
    }

    throw new ApiClientError(message, res.status, code, error?.details);
  };

  const res = await doFetch(true);
  return respond(res);
}

export const api = {
  baseUrl: API_BASE_URL,
  get: <T>(path: string, options?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "body" | "method">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};