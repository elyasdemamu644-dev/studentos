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
  error?: { code: string; message: string; details?: unknown };
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
    // A successful response is allowed to carry no body at all (204 No
    // Content, e.g. delete). Never treat that as a routing failure.
    // `headers` is optional so a partial Response-like stub (e.g. a test double)
    // does not blow up here.
    const contentType = res.headers?.get?.("content-type") ?? "";
    const isEmptyBody = res.status === 204 || res.status === 205;
    // Only distrust a body that is positively identified as HTML, or a non-JSON
    // error response. A missing content-type is not itself evidence of a
    // misroute — some legitimate responses (and test doubles) omit it.
    const looksLikeHtml = contentType.includes("text/html");
    if (!isEmptyBody && (looksLikeHtml || (res.status >= 400 && contentType && !contentType.includes("application/json")))) {
      const body = res.text ? await res.text().catch(() => "") : "";
      if (looksLikeHtml || /^\s*<!doctype html/i.test(body)) {
        throw new ApiClientError(
          `The API returned an HTML page instead of JSON (HTTP ${res.status}). ` +
            `NEXT_PUBLIC_API_URL is probably pointing at the web app (${API_BASE_URL}) ` +
            `rather than the API server.`,
          res.status,
          "API_BASE_URL_MISCONFIGURED",
        );
      }
      throw new ApiClientError(
        `Request failed (${res.status})`,
        res.status,
        "INVALID_RESPONSE",
      );
    }

    let json: Envelope<T> | null = null;
    if (!isEmptyBody) {
      try {
        json = (await res.json()) as Envelope<T>;
      } catch {
        // A JSON content-type with an unparseable body (e.g. a truncated
        // response). Treat it as an empty body so the status still drives the
        // outcome below.
      }
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

// ─────────────────────────────────────────────
// Multipart upload + binary download
// ─────────────────────────────────────────────
//
// The JSON transport above cannot express either of these, so they get their
// own paths while reusing the same base URL, bearer token and one-time 401
// refresh. Two rules are load-bearing:
//
//   • An upload NEVER sets `Content-Type`. Only the browser can add the
//     multipart boundary, and setting the header by hand (even to the right
//     value) drops the boundary and makes the body unparseable by the server.
//   • A download never parses the success body as JSON — it is raw file bytes.
//     The JSON error envelope is only read on a non-2xx response.

/** Guard against an HTML page (a mis-routed API base) where JSON was expected. */
async function assertNotHtml(res: Response): Promise<void> {
  const contentType = res.headers?.get?.("content-type") ?? "";
  const isEmptyBody = res.status === 204 || res.status === 205;
  const looksLikeHtml = contentType.includes("text/html");
  if (
    !isEmptyBody &&
    (looksLikeHtml ||
      (res.status >= 400 && contentType && !contentType.includes("application/json")))
  ) {
    const body = res.text ? await res.text().catch(() => "") : "";
    if (looksLikeHtml || /^\s*<!doctype html/i.test(body)) {
      throw new ApiClientError(
        `The API returned an HTML page instead of JSON (HTTP ${res.status}). ` +
          `NEXT_PUBLIC_API_URL is probably pointing at the web app (${API_BASE_URL}) ` +
          `rather than the API server.`,
        res.status,
        "API_BASE_URL_MISCONFIGURED",
      );
    }
    throw new ApiClientError(`Request failed (${res.status})`, res.status, "INVALID_RESPONSE");
  }
}

async function parseJsonEnvelope<T>(res: Response): Promise<Envelope<T> | null> {
  if (res.status === 204 || res.status === 205) return null;
  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    return null;
  }
}

/** Re-authenticate once and retry, or throw the typed API error. */
async function settleError<T>(
  res: Response,
  json: Envelope<unknown> | null,
  wasRefreshed: boolean,
  retry: () => Promise<T>,
  fallbackMessage: string,
): Promise<T> {
  const error = json?.error;
  const code = error?.code ?? "UNKNOWN_ERROR";
  if (res.status === 401 && AUTH_PROBLEM_CODES.has(code) && getRefreshToken() && !wasRefreshed) {
    const fresh = await attemptRefresh();
    if (fresh) return retry();
    throw new SessionExpiredError();
  }
  throw new ApiClientError(error?.message ?? fallbackMessage, res.status, code, error?.details);
}

async function uploadInternal<T>(
  path: string,
  formData: FormData,
  wasRefreshed: boolean,
): Promise<T> {
  const token = getAccessToken();
  const doFetch = async (withAuth: boolean): Promise<Response> => {
    const headers = new Headers();
    if (withAuth && token) headers.set("Authorization", `Bearer ${token}`);
    // No Content-Type on purpose: the browser sets it (with the boundary).
    try {
      return await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers, body: formData });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new NetworkError();
    }
  };

  const res = await doFetch(true);
  if (res.status >= 200 && res.status < 300) {
    const json = await parseJsonEnvelope<T>(res);
    if (json && json.success === true) return json.data as T;
    if (!json) return undefined as T;
  }

  await assertNotHtml(res);
  const json = await parseJsonEnvelope<unknown>(res);
  return settleError(
    res,
    json,
    wasRefreshed,
    () => uploadInternal<T>(path, formData, true),
    `Upload failed (${res.status})`,
  );
}

/** Extract the UTF-8-aware filename from a Content-Disposition header. */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain form below.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header);
  return plain ? plain[1] : null;
}

async function downloadInternal(
  path: string,
  wasRefreshed: boolean,
): Promise<{ blob: Blob; fileName: string | null }> {
  const token = getAccessToken();
  const doFetch = async (withAuth: boolean): Promise<Response> => {
    const headers = new Headers();
    if (withAuth && token) headers.set("Authorization", `Bearer ${token}`);
    try {
      return await fetch(`${API_BASE_URL}${path}`, { method: "GET", headers });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new NetworkError();
    }
  };

  const res = await doFetch(true);
  if (res.status >= 200 && res.status < 300) {
    const fileName = fileNameFromDisposition(res.headers?.get?.("content-disposition") ?? null);
    return { blob: await res.blob(), fileName };
  }

  await assertNotHtml(res);
  const json = await parseJsonEnvelope<unknown>(res);
  return settleError(
    res,
    json,
    wasRefreshed,
    () => downloadInternal(path, true),
    `Download failed (${res.status})`,
  );
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
  /** Send a multipart body. The browser owns the Content-Type (boundary). */
  upload: <T>(path: string, formData: FormData) => uploadInternal<T>(path, formData, false),
  /** Fetch raw bytes with the bearer token. Returns the blob + server filename. */
  download: (path: string) => downloadInternal(path, false),
};