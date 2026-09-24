import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Grades Module", () => {
  let token: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("grades@test.com", "Pass123!");
    token = auth.token;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2035-2036",
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2036-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2035",
      academicYearId: yearRes.body.data.id,
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2035-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "GRD101",
      name: "Data Structures",
      credits: 4,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;
  });

  describe("POST /grades", () => {
    it("should create a grade", async () => {
      const res = await authRequestJson("post", `${BASE}/grades`, token, {
        title: "Midterm",
        courseId,
        score: 38,
        maxScore: 50,
        weight: 0.3,
        type: "EXAM",
        recordedAt: "2035-10-15T00:00:00.000Z",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Midterm");
      expect(res.body.data.score).toBe(38);
      expect(res.body.data.maxScore).toBe(50);
      expect(res.body.data.type).toBe("EXAM");
      expect(res.body.data.courseId).toBe(courseId);
    });

    it("should reject score above maxScore", async () => {
      const res = await authRequestJson("post", `${BASE}/grades`, token, {
        title: "Impossible",
        score: 100,
        maxScore: 50,
      });

      expect(res.status).toBe(400);
    });

    it("should reject a nonexistent course", async () => {
      const res = await authRequestJson("post", `${BASE}/grades`, token, {
        title: "Ghost",
        courseId: "cuid_ghostcourse",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /grades", () => {
    it("should list grades and filter by courseId", async () => {
      const res = await authRequestJson("get", `${BASE}/grades?courseId=${courseId}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items[0].courseId).toBe(courseId);
    });

    it("should filter by type", async () => {
      const res = await authRequestJson("get", `${BASE}/grades?type=EXAM`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.every((g: { type: string }) => g.type === "EXAM")).toBe(true);
    });
  });

  describe("PATCH /grades/:id", () => {
    it("should update a grade", async () => {
      const created = await authRequestJson("post", `${BASE}/grades`, token, {
        title: "Quiz 1",
        score: 8,
        maxScore: 10,
      });

      const res = await authRequestJson("patch", `${BASE}/grades/${created.body.data.id}`, token, {
        score: 9,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(9);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's grade", async () => {
      const other = await registerAndLogin("grades-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/grades`, token, {
        title: "Private grade",
        score: 5,
        maxScore: 10,
      });

      const res = await authRequestJson("get", `${BASE}/grades/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });
});