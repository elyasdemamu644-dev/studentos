import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Task Subtasks Module", () => {
  let token: string;
  let taskId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("subtasks@test.com", "Pass123!");
    token = auth.token;

    const task = await authRequestJson("post", `${BASE}/tasks`, token, {
      title: "Build portfolio",
      type: "PROJECT",
    });
    taskId = task.body.data.id;
  });

  describe("POST /tasks/:taskId/subtasks", () => {
    it("should create a subtask with default position", async () => {
      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
        title: "Setup repo",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.taskId).toBe(taskId);
      expect(res.body.data.status).toBe("TODO");
      expect(res.body.data.position).toBe(0);
    });

    it("should default position to the end of the list", async () => {
      const first = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
        title: "First",
      });
      expect(first.body.data.position).toBe(1);

      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
        title: "Second",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.position).toBe(first.body.data.position + 1);
    });

    it("should reject subtasks on a nonexistent task", async () => {
      const res = await authRequestJson("post", `${BASE}/tasks/cuid_ghost/subtasks`, token, {
        title: "nope",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /tasks/:taskId/subtasks", () => {
    it("should list subtasks sorted by position", async () => {
      const res = await authRequestJson("get", `${BASE}/tasks/${taskId}/subtasks`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0].position).toBe(0);
    });

    it("should filter by status", async () => {
      const res = await authRequestJson("get", `${BASE}/tasks/${taskId}/subtasks?status=TODO`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((s: { status: string }) => s.status === "TODO")).toBe(true);
    });
  });

  describe("PATCH /tasks/:taskId/subtasks/:subtaskId", () => {
    it("should mark a subtask COMPLETED", async () => {
      const created = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
        title: "Write tests",
      });

      const res = await authRequestJson(
        "patch",
        `${BASE}/tasks/${taskId}/subtasks/${created.body.data.id}`,
        token,
        { status: "COMPLETED" },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.completedAt).not.toBeNull();
    });
  });

  describe("DELETE /tasks/:taskId/subtasks/:subtaskId", () => {
    it("should delete a subtask", async () => {
      const created = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
        title: "Doomed",
      });

      const res = await authRequestJson(
        "delete",
        `${BASE}/tasks/${taskId}/subtasks/${created.body.data.id}`,
        token,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not let another user touch the task's subtasks", async () => {
      const other = await registerAndLogin("subtasks-other@test.com", "Pass123!");

      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, other.token, {
        title: "Hacker subtask",
      });
      expect(res.status).toBe(404);
    });
  });
});