import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";

describe("Health Module", () => {
  it("GET /health returns 200 with database status when healthy", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBeDefined();
    expect(res.body.data.database).toBe("connected");
    expect(res.body.data.timestamp).toBeDefined();
  });

  it("GET /health is reachable without authentication", async () => {
    const res = await request(app).get("/health");
    expect(res.status).not.toBe(401);
  });
});