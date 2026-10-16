import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// The verifier is swapped for a controllable stub so the route is tested
// against fixed outcomes (like the AI-tools suite does for provider lookup).
// The app itself must be imported DYNAMICALLY after this mock registers —
// `setup.ts` imports `./helpers` → `@/app` during worker startup, which binds
// the real verifier into the router before any `vi.mock` factory can run.
vi.mock("@/services/google-oauth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/google-oauth")>();
  return { ...mod, verifyGoogleIdToken: vi.fn() };
});

import type { Express } from "express";
import type request from "supertest";
import { verifyGoogleIdToken } from "@/services/google-oauth";

const mockedVerify = vi.mocked(verifyGoogleIdToken);

let app: Express;
let supertest: typeof request;
// Imported from the FRESH module graph (see beforeAll): the app is rebuilt
// after `vi.resetModules()`, so ApiError instance checks (used by
// `globalErrorHandler`) must reference the same class identity the running
// app uses. Binding these at module scope would capture the stale graph.
let unauthorizedError: typeof import("@/config/errors")["unauthorizedError"];
let serviceUnavailableError: typeof import("@/config/errors")["serviceUnavailableError"];
const BASE = "/api/v1";

beforeAll(async () => {
  vi.resetModules();
  const appMod = await import("@/app");
  app = appMod.app;
  const errorsMod = await import("@/config/errors");
  unauthorizedError = errorsMod.unauthorizedError;
  serviceUnavailableError = errorsMod.serviceUnavailableError;
  const supertestMod = await import("supertest");
  supertest = supertestMod.default;
});

function stubClaims(overrides: Partial<{ sub: string; email: string; name: string; picture: string }> = {}) {
  return {
    sub: "google-sub-123",
    email: "google-user@example.com",
    email_verified: true,
    aud: "test-client-id",
    iss: "https://accounts.google.com",
    name: "Google User",
    picture: "https://example.com/avatar.png",
    ...overrides,
  };
}

describe("POST /auth/google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new user on first Google sign-in and returns a token pair", async () => {
    mockedVerify.mockResolvedValue(stubClaims());

    const res = await supertest(app)
      .post(`${BASE}/auth/google`)
      .send({ idToken: "valid.google.id.token" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        email: "google-user@example.com",
        firstName: "Google",
        lastName: "User",
        profilePicture: "https://example.com/avatar.png",
      },
    });
  });

  it("logs into an existing account when the email is already registered", async () => {
    // First sign-in creates the account.
    mockedVerify.mockResolvedValue(stubClaims());
    const first = await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "tok" });
    const userId = first.body.data.user.id;

    // Second sign-in must return the SAME user id (no duplicate account).
    const second = await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "tok" });

    expect(second.status).toBe(200);
    expect(second.body.data.user.id).toBe(userId);
    expect(second.body.data.user.email).toBe("google-user@example.com");
  });

  it("links a Google identity to an existing account despite email case differences", async () => {
    // Registration normalises the mailbox to lower case.
    const registered = await supertest(app)
      .post(`${BASE}/auth/register`)
      .send({ email: "Mixed.Case@Example.com", password: "Passw0rd!" });
    expect(registered.status).toBe(201);
    const registeredId = registered.body.data.id;
    expect(registered.body.data.email).toBe("mixed.case@example.com");

    // Google reports the same mailbox in lowercase.
    mockedVerify.mockResolvedValue(stubClaims({ email: "mixed.case@example.com" }));

    const google = await supertest(app)
      .post(`${BASE}/auth/google`)
      .send({ idToken: "valid.google.id.token" });

    expect(google.status).toBe(200);
    expect(google.body.data.user.id).toBe(registeredId);
    expect(google.body.data.user.email).toBe("mixed.case@example.com");
  });

  it("rejects an invalid Google token with 401", async () => {
    mockedVerify.mockRejectedValue(unauthorizedError("Invalid Google ID token"));

    const res = await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "forged.token" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("answers 503 when Google OAuth is not configured", async () => {
    mockedVerify.mockRejectedValue(
      serviceUnavailableError("Google OAuth is not configured (GOOGLE_CLIENT_ID)"),
    );

    const res = await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "tok" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("rejects a missing idToken with 400 VALIDATION_ERROR", async () => {
    const res = await supertest(app).post(`${BASE}/auth/google`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not allow a Google login to reveal other users' data", async () => {
    mockedVerify.mockResolvedValue(stubClaims());
    await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "tok" });

    const login = await supertest(app).post(`${BASE}/auth/google`).send({ idToken: "tok" });
    const token = login.body.data.accessToken;

    const me = await supertest(app)
      .get(`${BASE}/auth/me`)
      .set("Authorization", `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("google-user@example.com");
  });
});