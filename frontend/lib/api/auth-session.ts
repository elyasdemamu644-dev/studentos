// ─────────────────────────────────────────────
// Session storage (tokens + resolved auth state)
// ─────────────────────────────────────────────
//
// The API authenticates via `Authorization: Bearer <accessToken>` and issues
// rotating refresh tokens. We keep the session in memory and mirror it to
// localStorage so a page reload restores the session. Credentials are never
// placed in cookies or logged.

const ACCESS_KEY = "studentos.access";
const REFRESH_KEY = "studentos.refresh";

let memoryAccessToken: string | null = null;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  university: string | null;
  department: string | null;
  academicYear: string | null;
  timezone: string;
  profilePicture: string | null;
  createdAt: string;
}

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function getAccessToken(): string | null {
  if (memoryAccessToken) return memoryAccessToken;
  return safeGet(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return safeGet(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  memoryAccessToken = accessToken;
  safeSet(ACCESS_KEY, accessToken);
  safeSet(REFRESH_KEY, refreshToken);
}

export function hasSession(): boolean {
  return Boolean(getAccessToken() || getRefreshToken());
}

export function clearSession(): void {
  memoryAccessToken = null;
  safeRemove(ACCESS_KEY);
  safeRemove(REFRESH_KEY);
}

/**
 * Can run on the server? Always false for storage — sessions are browser-only.
 */
export function isAuthenticated(): boolean {
  return typeof window !== "undefined" && hasSession();
}