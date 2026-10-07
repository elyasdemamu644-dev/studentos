import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";

/**
 * A malformed body is a client mistake, so it must be reported as 4xx rather
 * than bubbling up as an unhandled 500 that leaks parser internals.
 */
describe("Malformed request bodies", () => {
  it("rejects a truncated JSON body with 400 instead of 500", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set("Content-Type", "application/json")
      .send('{"title": "Broken"');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect(res.body.error.message).not.toMatch(/SyntaxError|JSON\.parse/);
  });

  it("rejects a bare string body sent as JSON with 400", async () => {
    const res = await request(app)
      .post("/api/v1/tasks")
      .set("Content-Type", "application/json")
      .send('"eyJhbGciOiJIUzI1NiJ9"');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("still returns 404 for unmatched routes", async () => {
    // Must sit outside /api/v1, which authenticates before routing.
    const res = await request(app).get("/not-a-real-path");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
