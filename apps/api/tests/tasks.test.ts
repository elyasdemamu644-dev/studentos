import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin, authRequest, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Tasks Module", () => {
  let token: string;
  let userId: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("tasks@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    // Create academic year
    const yearRes = await authRequestJson(
      "post",
      `${BASE}/academics/years`,
      token,
      {
        name: "2034-2035",
        startDate: "2034-09-01T00:00:00.000Z",
        endDate: "2035-06-30T00:00:00.000Z",
      },
    );

    // Create semester
    const semRes = await authRequestJson(
      "post",
      `${BASE}/academics/semesters`,
      token,
      {
        name: "Fall 2034",
        academicYearId: yearRes.body.data.id,
        startDate: "2034-09-01T00:00:00.000Z",
        endDate: "2034-12-15T00:00:00.000Z",
      },
    );

    // Create course
    const courseRes = await authRequestJson(
      "post",
      `${BASE}/courses`,
      token,
      {
        code: "ENG101",
        name: "English Composition",
        credits: 3,
        semesterId: semRes.body.data.id,
      },
    );

    courseId = courseRes.body.data.id;
  });

  describe("POST /tasks", () => {
    it("should create a task", async () => {
      const res = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Read Chapter 1",
          description: "Read and take notes on Chapter 1 of the textbook",
          type: "READING",
          priority: "HIGH",
          dueDate: "2034-09-15T00:00:00.000Z",
          estimatedMinutes: 90,
          courseId: courseId,
        },
      );

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data.title).toBe("Read Chapter 1");
      expect(res.body.data.type).toBe("READING");
      expect(res.body.data.priority).toBe("HIGH");
      expect(res.body.data.status).toBe("TODO");
      expect(res.body.data.courseId).toBe(courseId);
      expect(res.body.data.estimatedMinutes).toBe(90);
    });

    it("should create a task without course", async () => {
      const res = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "General reminder",
          type: "OTHER",
          priority: "LOW",
        },
      );

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBeUndefined();
    });
  });

  describe("GET /tasks", () => {
    it("should list tasks for the user", async () => {
      const res = await authRequest("get", `${BASE}/tasks`, token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it("should filter by status", async () => {
      const res = await authRequest("get", `${BASE}/tasks?status=TODO`, token);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((t: any) => t.status === "TODO")).toBe(true);
    });

    it("should filter by priority", async () => {
      const res = await authRequest("get", `${BASE}/tasks?priority=HIGH`, token);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((t: any) => t.priority === "HIGH")).toBe(true);
    });

    it("should filter by courseId", async () => {
      const res = await authRequest("get", `${BASE}/tasks?courseId=${courseId}`, token);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((t: any) => t.courseId === courseId)).toBe(true);
    });
  });

  describe("GET /tasks/:id", () => {
    it("should get a single task with course info", async () => {
      // Create a task first
      const createRes = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Research paper outline",
          type: "ASSIGNMENT",
          priority: "URGENT",
          courseId: courseId,
        },
      );

      const taskId = createRes.body.data.id;
      const res = await authRequest("get", `${BASE}/tasks/${taskId}`, token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(taskId);
      expect(res.body.data.title).toBe("Research paper outline");
      expect(res.body.data.course).toBeDefined();
      expect(res.body.data.course.code).toBe("ENG101");
    });

    it("should return 404 for non-existent task", async () => {
      const res = await authRequest("get", `${BASE}/tasks/fake-id`, token);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /tasks/:id", () => {
    it("should update a task", async () => {
      // Create first
      const createRes = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Original title",
          type: "HOMEWORK",
        },
      );

      const taskId = createRes.body.data.id;

      const res = await authRequestJson(
        "patch",
        `${BASE}/tasks/${taskId}`,
        token,
        {
          title: "Updated title",
          priority: "URGENT",
          status: "IN_PROGRESS",
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Updated title");
      expect(res.body.data.priority).toBe("URGENT");
      expect(res.body.data.status).toBe("IN_PROGRESS");
      expect(res.body.data.id).toBe(taskId);
    });

    it("should move task to a different course", async () => {
      // Create a second course
      const yearRes = await authRequestJson(
        "post",
        `${BASE}/academics/years`,
        token,
        {
          name: "2035-2036",
          startDate: "2035-09-01T00:00:00.000Z",
          endDate: "2036-06-30T00:00:00.000Z",
        },
      );

      const semRes = await authRequestJson(
        "post",
        `${BASE}/academics/semesters`,
        token,
        {
          name: "Spring 2035",
          academicYearId: yearRes.body.data.id,
          startDate: "2035-01-15T00:00:00.000Z",
          endDate: "2035-05-15T00:00:00.000Z",
        },
      );

      const courseRes = await authRequestJson(
        "post",
        `${BASE}/courses`,
        token,
        {
          code: "HIST101",
          name: "History 101",
          credits: 3,
          semesterId: semRes.body.data.id,
        },
      );

      const secondCourseId = courseRes.body.data.id;

      // Create task in first course
      const createRes = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Task to move",
          courseId: courseId,
        },
      );

      // Move it
      const res = await authRequestJson(
        "patch",
        `${BASE}/tasks/${createRes.body.data.id}`,
        token,
        { courseId: secondCourseId },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.courseId).toBe(secondCourseId);
      expect(res.body.data.course.code).toBe("HIST101");
    });
  });

  describe("POST /tasks/:id/complete", () => {
    it("should mark a task as COMPLETED", async () => {
      // Create first
      const createRes = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Task to complete",
          status: "TODO",
        },
      );

      const taskId = createRes.body.data.id;

      const res = await authRequest("post", `${BASE}/tasks/${taskId}/complete`, token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data).toHaveProperty("completedAt");
    });

    it("should return 404 for non-existent task", async () => {
      const res = await authRequest("post", `${BASE}/tasks/fake-id/complete`, token);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /tasks/:id", () => {
    it("should delete a task", async () => {
      // Create first
      const createRes = await authRequestJson(
        "post",
        `${BASE}/tasks`,
        token,
        {
          title: "Task to delete",
        },
      );

      const taskId = createRes.body.data.id;

      const res = await authRequest("delete", `${BASE}/tasks/${taskId}`, token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
    });
  });
});
