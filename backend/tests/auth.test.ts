import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "@/app";

/**
 * Test helpers — shared setup for all integration tests.
 *
 * Each test starts with a clean database (migrations applied, then
 * Prisma truncates non-idempotent seed data).  Shared helpers `register`,
 * `login`, `authRequest` wrap the raw HTTP calls so test cases read like
 * user stories.
 */

import { registerAndLogin, authRequest, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Auth Module — StudentOS MVP", () => {
  // ── Registration ──────────────────────────────────────────────
  describe("POST /auth/register", () => {
    it("creates a user and returns 201 with the user payload", async () => {
      const payload = {
        email: "alice@studentos.test",
        password: "SafePass1!",
        firstName: "Alice",
        lastName: "Demo",
        university: "Test University",
        department: "Computer Science",
      };

      const res = await request(app)
        .post(`${BASE}/auth/register`)
        .send(payload)
        .expect(201);

      expect(res.body).toMatchObject({
        success: true,
        data: {
          id: expect.any(String),
          email: "alice@studentos.test",
          firstName: "Alice",
          lastName: "Demo",
          university: "Test University",
          department: "Computer Science",
        },
      });
    });

    it("rejects duplicate emails with 409", async () => {
      await registerAndLogin("dup@studentos.test", "SafePass1!");
      await request(app)
        .post(`${BASE}/auth/register`)
        .send({ email: "dup@studentos.test", password: "x" })
        .expect(409);
    });
  });

  // ── Login ─────────────────────────────────────────────────────
  describe("POST /auth/login", () => {
    const creds = {
      email: "login@studentos.test",
      password: "SafePass1!",
    };

    beforeAll(async () => {
      await registerAndLogin(creds.email, creds.password);
    });

    it("returns access + refresh tokens on valid credentials", async () => {
      const loginRes = await request(app)
        .post(`${BASE}/auth/login`)
        .send(creds)
        .expect(200);

      expect(loginRes.body).toMatchObject({
        success: true,
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: {
            email: creds.email,
          },
        },
      });
    });

    it("rejects wrong password with 401", async () => {
      await request(app)
        .post(`${BASE}/auth/login`)
        .send({ email: creds.email, password: "wrong" })
        .expect(401);
    });

    it("rejects unknown email with 401", async () => {
      await request(app)
        .post(`${BASE}/auth/login`)
        .send({ email: "nobody@studentos.test", password: "x" })
        .expect(401);
    });
  });

  // ── Refresh ───────────────────────────────────────────────────
  describe("POST /auth/refresh", () => {
    let refreshToken: string;

    beforeAll(async () => {
      const creds = { email: "refresh@studentos.test", password: "SafePass1!" };
      await registerAndLogin(creds.email, creds.password);
      const loginRes = await request(app)
        .post(`${BASE}/auth/login`)
        .send(creds);
      refreshToken = loginRes.body.data.refreshToken;
    });

    it("issues a new access token from a valid refresh token", async () => {
      const res = await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toMatchObject({
        success: true,
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
      });
    });

    it("rejects an invalid refresh token with 401", async () => {
      await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: "bad.token" })
        .expect(401);
    });
  });

  // ── Logout ────────────────────────────────────────────────────
  describe("POST /auth/logout", () => {
    let refreshToken: string;

    beforeAll(async () => {
      const creds = { email: "logout@studentos.test", password: "SafePass1!" };
      await registerAndLogin(creds.email, creds.password);
      const loginRes = await request(app)
        .post(`${BASE}/auth/login`)
        .send(creds);
      refreshToken = loginRes.body.data.refreshToken;
    });

    it("invalidates the refresh token and returns 200", async () => {
      await request(app)
        .post(`${BASE}/auth/logout`)
        .send({ refreshToken })
        .expect(200);

      // Subsequent refresh must fail.
      await request(app)
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken })
        .expect(401);
    });
  });

  // ── Me (profile endpoint) ─────────────────────────────────────
  describe("GET /auth/me", () => {
    let accessToken: string;

    beforeAll(async () => {
      const creds = { email: "me@studentos.test", password: "SafePass1!" };
      await registerAndLogin(creds.email, creds.password);
      const loginRes = await request(app)
        .post(`${BASE}/auth/login`)
        .send(creds);
      accessToken = loginRes.body.data.accessToken;
    });

    it("returns the authenticated user's profile", async () => {
      const res = await authRequest(accessToken, "get", `${BASE}/auth/me`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: {
          email: "me@studentos.test",
        },
      });
    });

    it("rejects unauthenticated requests with 401", async () => {
      await request(app)
        .get(`${BASE}/auth/me`)
        .expect(401);
    });
  });
});
