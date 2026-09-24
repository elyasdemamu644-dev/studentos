import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Goals Module", () => {
  let token: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("goals@test.com", "Pass123!");
    token = auth.token;
  });

  describe("POST /goals", () => {
    it("should create a goal", async () => {
      const res = await authRequestJson("post", `${BASE}/goals`, token, {
        title: "Pass Algorithms",
        description: "Score >= 80 on all exams",
        deadline: "2035-06-01T00:00:00.000Z",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Pass Algorithms");
      expect(res.body.data.status).toBe("ACTIVE");
      expect(res.body.data.progress).toBe(0);
      expect(res.body.data.milestones).toEqual([]);
    });

    it("should reject an empty title", async () => {
      const res = await authRequestJson("post", `${BASE}/goals`, token, { title: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /goals", () => {
    it("should list goals and filter by status", async () => {
      await authRequestJson("post", `${BASE}/goals`, token, { title: "Learn SQL" });

      const res = await authRequestJson("get", `${BASE}/goals?status=ACTIVE`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items.every((g: { status: string }) => g.status === "ACTIVE")).toBe(true);
    });
  });

  describe("PATCH /goals/:id", () => {
    it("should update progress and complete the goal", async () => {
      const created = await authRequestJson("post", `${BASE}/goals`, token, { title: "Run 5k" });

      const res = await authRequestJson("patch", `${BASE}/goals/${created.body.data.id}`, token, {
        progress: 100,
        status: "COMPLETED",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.progress).toBe(100);
      expect(res.body.data.status).toBe("COMPLETED");
    });

    it("should reject progress above 100", async () => {
      const created = await authRequestJson("post", `${BASE}/goals`, token, { title: "Read books" });

      const res = await authRequestJson("patch", `${BASE}/goals/${created.body.data.id}`, token, {
        progress: 150,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("Milestones", () => {
    it("should create and list milestones under a goal", async () => {
      const goal = await authRequestJson("post", `${BASE}/goals`, token, {
        title: "Finish project",
      });

      const ms = await authRequestJson("post", `${BASE}/goals/${goal.body.data.id}/milestones`, token, {
        title: "Draft",
        position: 0,
      });
      expect(ms.status).toBe(201);
      expect(ms.body.data.title).toBe("Draft");

      const list = await authRequestJson("get", `${BASE}/goals/${goal.body.data.id}/milestones`, token);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
    });

    it("should update a milestone to COMPLETED", async () => {
      const goal = await authRequestJson("post", `${BASE}/goals`, token, { title: "App launch" });
      const ms = await authRequestJson("post", `${BASE}/goals/${goal.body.data.id}/milestones`, token, {
        title: "Beta",
      });

      const res = await authRequestJson("patch", `${BASE}/goals/${goal.body.data.id}/milestones/${ms.body.data.id}`, token, {
        status: "COMPLETED",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.completedAt).not.toBeNull();
    });

    it("should delete a milestone", async () => {
      const goal = await authRequestJson("post", `${BASE}/goals`, token, { title: "Cleanup" });
      const ms = await authRequestJson("post", `${BASE}/goals/${goal.body.data.id}/milestones`, token, {
        title: "Remove",
      });

      const res = await authRequestJson("delete", `${BASE}/goals/${goal.body.data.id}/milestones/${ms.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's goal", async () => {
      const other = await registerAndLogin("goals-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/goals`, token, { title: "Private goal" });

      const res = await authRequestJson("get", `${BASE}/goals/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);

      const msRes = await authRequestJson("post", `${BASE}/goals/${mine.body.data.id}/milestones`, other.token, {
        title: "nope",
      });
      expect(msRes.status).toBe(404);
    });
  });
});