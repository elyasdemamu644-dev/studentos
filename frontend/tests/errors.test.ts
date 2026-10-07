import { describe, expect, it } from "vitest";
import { ApiClientError, NetworkError, SessionExpiredError, toClientError } from "@/lib/api/errors";

describe("lib/api errors", () => {
  it("passes through existing ApiClientError instances", () => {
    const err = new ApiClientError("boom", 400, "BAD_REQUEST");
    expect(toClientError(err, "fallback")).toBe(err);
  });

  it("maps network failures to NetworkError", () => {
    const mapped = toClientError(new TypeError("fetch failed"), "fallback");
    expect(mapped).toBeInstanceOf(NetworkError);
    expect(mapped.code).toBe("NETWORK_ERROR");
  });

  it("maps unknown errors to INTERNAL_ERROR", () => {
    const mapped = toClientError(new Error("weird"), "fallback");
    expect(mapped).toBeInstanceOf(ApiClientError);
    expect(mapped).not.toBeInstanceOf(NetworkError);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.message).toBe("fallback");
    expect(mapped.status).toBe(500);
  });

  it("exposes a session expired variant", () => {
    const err = new SessionExpiredError();
    expect(err.code).toBe("SESSION_EXPIRED");
    expect(err.status).toBe(401);
  });
});