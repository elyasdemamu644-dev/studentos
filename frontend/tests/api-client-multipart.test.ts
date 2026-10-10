import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api/client";
import { ApiClientError } from "@/lib/api/errors";
import { clearSession, setTokens } from "@/lib/api/auth-session";

/**
 * The JSON transport could not express these two operations. The contracts
 * worth protecting:
 *
 *   · an upload must NOT set `Content-Type` (only the browser can add the
 *     multipart boundary), must carry the bearer token, and must still parse
 *     the JSON envelope;
 *   · a download must return raw bytes (never call `json()` on success) and
 *     still map a JSON error envelope into a typed error on failure;
 *   · both must reuse the one-time 401 refresh-and-retry.
 */

interface StubResponse {
  status: number;
  ok: boolean;
  headers: { get: (key: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  blob: () => Promise<Blob>;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
): StubResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (key) => headers[key.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  };
}

function blobResponse(blob: Blob, headers: Record<string, string> = {}): StubResponse {
  return {
    status: 200,
    ok: true,
    headers: { get: (key) => headers[key.toLowerCase()] ?? null },
    json: async () => ({}),
    text: async () => "",
    blob: async () => blob,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setTokens("access-token", "refresh-token");
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe("api.upload", () => {
  it("posts FormData without a Content-Type and returns the parsed data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "r1" } }, 201));

    const form = new FormData();
    form.append("title", "Lecture notes");
    const result = await api.upload<{ id: string }>("/resources/upload", form);

    expect(result).toEqual({ id: "r1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/resources/upload")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(form);
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer access-token");
    // The browser owns this header; setting it by hand drops the boundary.
    expect(headers.get("content-type")).toBeNull();
  });

  it("maps a JSON error envelope to a typed ApiClientError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "UNSUPPORTED_FILE_TYPE", message: "This file type is not allowed" } },
        400,
      ),
    );

    await expect(api.upload("/resources/upload", new FormData())).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "This file type is not allowed",
    });
  });

  it("refreshes the token once and retries on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: { code: "AUTH_TOKEN_EXPIRED", message: "expired" } }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { accessToken: "new-access", refreshToken: "new-refresh" } }, 200),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: "r2" } }, 201));

    const result = await api.upload<{ id: string }>("/resources/upload", new FormData());

    expect(result).toEqual({ id: "r2" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The retry re-read the fresh token.
    const retryHeaders = (fetchMock.mock.calls[2][1] as RequestInit).headers as Headers;
    expect(retryHeaders.get("authorization")).toBe("Bearer new-access");
  });
});

describe("api.download", () => {
  it("returns the blob and the UTF-8 filename from Content-Disposition", async () => {
    const blob = new Blob(["hello"]);
    fetchMock.mockResolvedValue(
      blobResponse(blob, {
        "content-disposition":
          "attachment; filename=\"lecture notes.pdf\"; filename*=UTF-8''lecture%20notes.pdf",
      }),
    );

    const result = await api.download("/resources/r1/download");

    expect(result.blob).toBe(blob);
    expect(result.fileName).toBe("lecture notes.pdf");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("authorization")).toBe("Bearer access-token");
  });

  it("throws a typed error for a JSON error response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: { code: "NOT_FOUND", message: "Resource not found" } }, 404),
    );

    await expect(api.download("/resources/gone/download")).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.download("/resources/gone/download")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
