import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

import { app } from "@/app";
import { registerAndLogin } from "./helpers";

const BASE = "/api/v1";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const FORBIDDEN_IN_BODY = /prisma|unique constraint|constraint_|relation\s|"SELECT |\.ts:\d+|stack/i;

/**
 * Contract-level guarantees that hold across the whole API. These are the
 * assertions that would have caught the two drift bugs the project has had:
 * a module that forgot the `success` field (the UI rendered "Request failed
 * (200)") and an error path that echoed a raw Prisma message to the client.
 */
describe("API contract safety", () => {
  let accessToken = "";
  let yearId = "";

  beforeAll(async () => {
    const user = await registerAndLogin({
      email: "contract-safety@studentos.test",
      password: "SafePass1!",
    });
    accessToken = user.accessToken;

    const year = await request(app)
      .post(`${BASE}/academics/academic-years`)
      .set(auth(accessToken))
      .send({ name: "Contract year", startDate: "2026-09-01", endDate: "2027-06-30" })
      .expect(201);
    yearId = year.body.data.id;
  });

  // ── Authentication ──────────────────────────────────────────

  const PROTECTED: Array<[string, string]> = [
    ["get", "/auth/me"],
    ["get", "/academics/academic-years"],
    ["post", "/academics/semesters"],
    ["get", "/courses"],
    ["delete", "/courses/some-id"],
    ["get", "/dashboard"],
    ["get", "/tasks"],
    ["post", "/tasks"],
    ["get", "/tasks/some-id/subtasks"],
    ["get", "/tasks/some-id/tags"],
    ["get", "/notes"],
    ["post", "/notes"],
    ["get", "/resources"],
    ["get", "/events"],
    ["get", "/study-sessions"],
    ["get", "/goals"],
    ["get", "/grades"],
    ["get", "/notifications"],
    ["post", "/notifications/generate"],
    ["post", "/notifications/read-all"],
    ["get", "/settings"],
    ["patch", "/settings"],
    ["get", "/ai/conversations"],
    ["get", "/ai/study-plans"],
    ["get", "/ai-connections"],
    ["post", "/ai-connections"],
  ];

  it("answers every protected module with one standard 401 envelope", async () => {
    for (const [method, path] of PROTECTED) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (request(app) as any)[method](BASE + path);

      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body.success).toBe(false);
      expect(["AUTH_INVALID_TOKEN", "AUTH_TOKEN_EXPIRED", "UNAUTHORIZED"]).toContain(
        res.body.error.code,
      );
      expect(res.body.error.details).toEqual([]);
      expect(`${res.body.error.message}${res.body.error.code}`).not.toMatch(FORBIDDEN_IN_BODY);
    }
  });

  it("keeps the five public endpoints reachable without a token", async () => {
    await request(app).get("/health").expect(200);
    await request(app).post(`${BASE}/auth/login`).send({ email: "nobody@x.test", password: "x" }).expect(401);
    await request(app).post(`${BASE}/auth/refresh`).send({ refreshToken: "nope" }).expect(401);
    await request(app).post(`${BASE}/auth/logout`).send({ refreshToken: "nope" }).expect(200);
    // Unmatched routes below /api/v1 are still 401, because the router
    // authenticates before it can tell the path does not exist.
    await request(app).get(`${BASE}/not-a-real-path`).expect(401);
  });

  it("does not tell an attacker whether an email exists at login", async () => {
    const unknown = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: "missing@studentos.test", password: "whatever" });
    const wrongPassword = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: "contract-safety@studentos.test", password: "wrong" });

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.error).toEqual(wrongPassword.body.error);
  });

  // ── Success envelope ────────────────────────────────────────

  const LISTS = [
    "/academics/academic-years",
    "/academics/semesters",
    "/courses",
    "/dashboard",
    "/tasks",
    "/notes",
    "/resources",
    "/events",
    "/study-sessions",
    "/goals",
    "/grades",
    "/notifications",
    "/settings",
    "/ai/conversations",
    "/ai/study-plans",
    "/ai-connections",
  ];

  it("returns { success: true, data } from every list endpoint", async () => {
    for (const path of LISTS) {
      const res = await request(app).get(BASE + path).set(auth(accessToken));

      expect(res.status, `GET ${path}`).toBe(200);
      expect(res.body.success, `GET ${path}`).toBe(true);
      expect(res.body.data, `GET ${path}`).toBeDefined();
      expect(Object.keys(res.body).sort()).toEqual(["data", "success"]);
    }
  });

  it("uses the cursor page shape where pagination is documented", async () => {
    for (const path of ["/tasks", "/notes", "/events", "/ai-connections"]) {
      const res = await request(app).get(BASE + path).set(auth(accessToken));

      expect(Array.isArray(res.body.data.items), path).toBe(true);
      expect(typeof res.body.data.hasMore, path).toBe("boolean");
      expect(path in res.body.data ? false : true, path).toBe(true);
      expect(res.body.data).toHaveProperty("nextCursor");
    }
  });

  it("keeps the deliberate bare-array lists bare", async () => {
    const years = await request(app).get(`${BASE}/academics/academic-years`).set(auth(accessToken));
    expect(Array.isArray(years.body.data)).toBe(true);
  });

  it("does not duplicate entity fields at the top level of a course response", async () => {
    const created = await request(app)
      .post(`${BASE}/courses`)
      .set(auth(accessToken))
      .send({ name: "Contract Course", code: "CON101" })
      .expect(201);

    expect(Object.keys(created.body).sort()).toEqual(["data", "success"]);
    expect(created.body.id).toBeUndefined();

    const fetched = await request(app)
      .get(`${BASE}/courses/${created.body.data.id}`)
      .set(auth(accessToken))
      .expect(200);
    expect(Object.keys(fetched.body).sort()).toEqual(["data", "success"]);
  });

  // ── Validation ──────────────────────────────────────────────

  it("rejects out-of-range pagination with per-field details", async () => {
    for (const query of ["limit=0", "limit=101"]) {
      const res = await request(app).get(`${BASE}/tasks?${query}`).set(auth(accessToken));

      expect(res.status, query).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      for (const detail of res.body.error.details) {
        expect(typeof detail.path).toBe("string");
        expect(typeof detail.message).toBe("string");
      }
    }
  });

  it("applies the endpoint-specific cursor bound", async () => {
    const res = await request(app)
      .get(`${BASE}/ai-connections?cursor=${"a".repeat(65)}`)
      .set(auth(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unparseable date filter", async () => {
    const res = await request(app).get(`${BASE}/events?startFrom=not-a-date`).set(auth(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  // ── Error hygiene ───────────────────────────────────────────

  it("never leaks database internals in a conflict", async () => {
    const duplicate = await request(app)
      .post(`${BASE}/academics/academic-years`)
      .set(auth(accessToken))
      .send({ name: "Contract year", startDate: "2026-09-01", endDate: "2027-06-30" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.success).toBe(false);
    expect(duplicate.body.error.code).toBe("CONFLICT");
    expect(duplicate.body.error.details).toBeDefined();
    expect(JSON.stringify(duplicate.body)).not.toMatch(FORBIDDEN_IN_BODY);
  });

  it("never leaks database internals in a not-found", async () => {
    const missing = await request(app).get(`${BASE}/notes/cmisuchanotexist0000000`).set(auth(accessToken));

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(missing.body)).not.toMatch(FORBIDDEN_IN_BODY);
  });

  it("does not echo the query string back in a 404 message", async () => {
    const res = await request(app).get("/not-a-real-path?token=TOPSECRETVALUE");

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain("/not-a-real-path");
    expect(JSON.stringify(res.body)).not.toContain("TOPSECRETVALUE");
  });

  // ── Transport headers ──────────────────────────────────────

  it("correlates every response with a request id and hides the framework", async () => {
    const ok = await request(app).get("/health");
    expect(ok.headers["x-request-id"]).toMatch(/^req_/);
    expect(ok.headers["x-powered-by"]).toBeUndefined();

    const failed = await request(app).get(`${BASE}/tasks`);
    expect(failed.headers["x-request-id"]).toMatch(/^req_/);
    expect(failed.headers["x-powered-by"]).toBeUndefined();
  });

  it("keeps the ownership rule: 404, never 403", async () => {
    const other = await registerAndLogin({
      email: "contract-other@studentos.test",
      password: "SafePass1!",
    });

    const res = await request(app)
      .get(`${BASE}/academics/academic-years/${yearId}`)
      .set(auth(other.accessToken));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.details).toEqual([]);
  });
});
