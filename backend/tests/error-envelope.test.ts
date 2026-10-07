import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { app } from "@/app";
import { globalErrorHandler, notFoundHandler } from "@/config/http";
import { rateLimiter, resetRateLimiter } from "@/utils/rate-limit";
import { prisma, registerAndLogin } from "./helpers";

/**
 * Phase 1 hardening: the error contract and the HTTP layer around it.
 *
 * These tests pin the three guarantees the API now makes:
 *   1. every failure carries `{ code, message, details }` — never a bare
 *      code/message, never a leaked stack trace or raw database message
 *   2. constraint violations map to the status a client can act on
 *      (duplicate create → 409, not 400)
 *   3. rate limiting answers 429 through the same envelope, with the
 *      headers a client needs to back off
 */

describe("Error envelope", () => {
  it("reports validation failures with a field-level details list", async () => {
    const { token } = await registerAndLogin("envelope-validation@test.com", "Passw0rd!");

    const res = await request(app)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "",
        description: null,
        courseId: null,
        priority: "MEDIUM",
        type: "ASSIGNMENT",
        dueDate: null,
        estimatedMinutes: null,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    // `details` must be present and shaped so a form can map it to a field.
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(res.body.error.details[0]).toMatchObject({
      path: expect.any(String),
      message: expect.any(String),
      code: expect.any(String),
    });
  });

  it("always includes details, using [] when there is nothing to report", async () => {
    const res = await request(app).get("/definitely-not-a-route");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.details).toEqual([]);
  });

  it("uses the same envelope for 401s raised by the auth middleware", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
      details: [],
    });
  });

  it("rejects an oversized or malformed body as 400, not 500", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.com", "password": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect(res.body.error.details).toEqual([]);
    // Parser internals must not leak.
    expect(res.body.error.message).not.toMatch(/SyntaxError|JSON\.parse/);
  });
});

describe("Prisma constraint violations", () => {
  it("maps a duplicate create to 409 CONFLICT", async () => {
    const { token } = await registerAndLogin("envelope-conflict@test.com", "Passw0rd!");
    const connection = {
      provider: "openai",
      credentials: "sk-test-key",
      model: null,
      endpoint: null,
    };

    const first = await request(app)
      .post("/api/v1/ai-connections")
      .set("Authorization", `Bearer ${token}`)
      .send(connection);
    expect(first.status).toBe(201);

    // `@@unique([userId, provider])` fires here; the raw Prisma message must
    // not surface, and the client must be told this is a conflict.
    const second = await request(app)
      .post("/api/v1/ai-connections")
      .set("Authorization", `Bearer ${token}`)
      .send(connection);

    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.error.code).toBe("CONFLICT");
    expect(second.body.error.details).toEqual([]);
    expect(second.body.error.message).not.toMatch(/Unique constraint|prisma/i);
  });
});

describe("Refresh tokens", () => {
  it("rejects a refresh token whose stored row has expired", async () => {
    const { refreshToken } = await registerAndLogin(
      "envelope-refresh@test.com",
      "Passw0rd!",
    );

    // The signed JWT is still valid (7d); only the database row has lapsed.
    // Refresh must honour the row — otherwise revocation by TTL is impossible.
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.details).toEqual([]);
  });
});

describe("Rate limiting", () => {
  afterEach(() => resetRateLimiter());

  function buildLimitedApp() {
    const limited = express();
    limited.use(express.json());
    // `enabled: true` overrides the test-mode default; the limiter mounted in
    // app.ts stays off so the rest of the suite is never throttled.
    limited.use(rateLimiter({ enabled: true, max: 2, windowSeconds: 60 }));
    limited.get("/ping", (_req, res) => res.json({ success: true, data: "pong" }));
    limited.use(notFoundHandler);
    limited.use(globalErrorHandler);
    return limited;
  }

  it("serves requests under the limit and advertises the budget", async () => {
    const limited = buildLimitedApp();

    const first = await request(limited).get("/ping");
    expect(first.status).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("2");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");

    const second = await request(limited).get("/ping");
    expect(second.status).toBe(200);
    expect(second.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("answers 429 through the standard envelope with Retry-After", async () => {
    const limited = buildLimitedApp();

    await request(limited).get("/ping");
    await request(limited).get("/ping");

    const throttled = await request(limited).get("/ping");

    expect(throttled.status).toBe(429);
    expect(throttled.body.success).toBe(false);
    expect(throttled.body.error.code).toBe("RATE_LIMITED");
    expect(throttled.body.error.details).toEqual([]);
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
    expect(throttled.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("keeps counting per window rather than latching forever", async () => {
    // Buckets are keyed by client IP, so start from a clean slate — the two
    // tests above already consumed this IP's budget in their own apps.
    resetRateLimiter();

    const short = express();
    short.use(rateLimiter({ enabled: true, max: 1, windowSeconds: 1 }));
    short.get("/ping", (_req, res) => res.json({ ok: true }));
    short.use(globalErrorHandler);

    expect((await request(short).get("/ping")).status).toBe(200);
    expect((await request(short).get("/ping")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await request(short).get("/ping")).status).toBe(200);
  });
});
