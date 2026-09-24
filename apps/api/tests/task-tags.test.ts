import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Task Tags Module", () => {
  let token: string;
  let taskId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("tags@test.com", "Pass123!");
    token = auth.token;

    const task = await authRequestJson("post", `${BASE}/tasks`, token, {
      title: "Research paper",
      type: "ASSIGNMENT",
    });
    taskId = task.body.data.id;
  });

  describe("POST /tasks/:taskId/tags", () => {
    it("should add a tag to a task", async () => {
      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, token, {
        name: "urgent",
        color: "red",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("urgent");
      expect(res.body.data.color).toBe("red");
      expect(res.body.data.taskId).toBe(taskId);
    });

    it("should reject duplicate tags on the same task", async () => {
      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, token, {
        name: "urgent",
      });

      expect(res.status).toBe(409);
    });

    it("should reject tags on a nonexistent task", async () => {
      const res = await authRequestJson("post", `${BASE}/tasks/cuid_ghost/tags`, token, {
        name: "nope",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /tasks/:taskId/tags", () => {
    it("should list a task's tags", async () => {
      const res = await authRequestJson("get", `${BASE}/tasks/${taskId}/tags`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("urgent");
    });
  });

  describe("PATCH /tasks/:taskId/tags/:tagId", () => {
    it("should recolor a tag", async () => {
      const list = await authRequestJson("get", `${BASE}/tasks/${taskId}/tags`, token);
      const tagId = list.body.data[0].id;

      const res = await authRequestJson("patch", `${BASE}/tasks/${taskId}/tags/${tagId}`, token, {
        color: "blue",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.color).toBe("blue");
    });

    it("should reject renaming onto an existing tag", async () => {
      await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, token, { name: "later" });

      const list = await authRequestJson("get", `${BASE}/tasks/${taskId}/tags`, token);
      const later = list.body.data.find((t: { name: string }) => t.name === "later");
      const urgent = list.body.data.find((t: { name: string }) => t.name === "urgent");

      const res = await authRequestJson("patch", `${BASE}/tasks/${taskId}/tags/${later.id}`, token, {
        name: "urgent",
      });

      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /tasks/:taskId/tags/:tagId", () => {
    it("should delete a tag", async () => {
      const created = await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, token, {
        name: "temp",
      });

      const res = await authRequestJson("delete", `${BASE}/tasks/${taskId}/tags/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not let another user manage the task's tags", async () => {
      const other = await registerAndLogin("tags-other@test.com", "Pass123!");

      const res = await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, other.token, {
        name: "hacker",
      });
      expect(res.status).toBe(404);
    });
  });
});