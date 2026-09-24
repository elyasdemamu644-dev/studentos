import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Study Sessions Module", () => {
  let token: string;
  let courseId: string;
  let taskId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("sessions@test.com", "Pass123!");
    token = auth.token;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2036-2037",
      startDate: "2036-09-01T00:00:00.000Z",
      endDate: "2037-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2036",
      academicYearId: yearRes.body.data.id,
      startDate: "2036-09-01T00:00:00.000Z",
      endDate: "2036-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "SS101",
      name: "Study Skills",
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;

    const taskRes = await authRequestJson("post", `${BASE}/tasks`, token, {
      title: "Read chapter 3",
      type: "READING",
    });
    taskId = taskRes.body.data.id;
  });

  describe("POST /study-sessions", () => {
    it("should create a study session for a course + task", async () => {
      const res = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        courseId,
        taskId,
        topic: "Chapter 3",
        startedAt: "2036-10-01T18:00:00.000Z",
        durationMinutes: 60,
        focusRating: 4,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(courseId);
      expect(res.body.data.taskId).toBe(taskId);
      expect(res.body.data.topic).toBe("Chapter 3");
      expect(res.body.data.durationMinutes).toBe(60);
    });

    it("should reject a session with a nonexistent task", async () => {
      const res = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        taskId: "cuid_ghosttask",
        startedAt: "2036-10-01T18:00:00.000Z",
      });

      expect(res.status).toBe(404);
    });

    it("should reject focusRating out of range", async () => {
      const res = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        startedAt: "2036-10-01T18:00:00.000Z",
        focusRating: 9,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /study-sessions/:id/complete", () => {
    it("should complete and compute durationMinutes", async () => {
      const created = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        topic: "Focused block",
        startedAt: "2036-10-02T09:00:00.000Z",
      });

      const res = await authRequestJson("post", `${BASE}/study-sessions/${created.body.data.id}/complete`, token, {
        endedAt: "2036-10-02T10:30:00.000Z",
        focusRating: 5,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.endedAt).toBe("2036-10-02T10:30:00.000Z");
      expect(res.body.data.durationMinutes).toBe(90);
    });

    it("should reject endedAt before startedAt", async () => {
      const created = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        startedAt: "2036-10-03T09:00:00.000Z",
      });

      const res = await authRequestJson("post", `${BASE}/study-sessions/${created.body.data.id}/complete`, token, {
        endedAt: "2036-10-03T08:00:00.000Z",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /study-sessions", () => {
    it("should list sessions and filter by range=today", async () => {
      const res = await authRequestJson("get", `${BASE}/study-sessions?range=today`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.summary).toBeDefined();
    });

    it("should filter by courseId", async () => {
      const res = await authRequestJson("get", `${BASE}/study-sessions?courseId=${courseId}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items.every((s: { courseId: string }) => s.courseId === courseId)).toBe(true);
    });
  });

  describe("PATCH /study-sessions/:id", () => {
    it("should update a session topic", async () => {
      const created = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        topic: "Old topic",
        startedAt: "2036-10-04T09:00:00.000Z",
      });

      const res = await authRequestJson("patch", `${BASE}/study-sessions/${created.body.data.id}`, token, {
        topic: "New topic",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.topic).toBe("New topic");
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's session", async () => {
      const other = await registerAndLogin("sessions-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/study-sessions`, token, {
        topic: "Private",
        startedAt: "2036-10-05T09:00:00.000Z",
      });

      const res = await authRequestJson("get", `${BASE}/study-sessions/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });
});