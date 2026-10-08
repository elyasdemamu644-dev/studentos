import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Notes Module", () => {
  let token: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("notes@test.com", "Pass123!");
    token = auth.token;
  });

  async function createCourse(code: string) {
    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2039-2040",
      startDate: "2039-09-01T00:00:00.000Z",
      endDate: "2040-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2039",
      academicYearId: yearRes.body.data.id,
      startDate: "2039-09-01T00:00:00.000Z",
      endDate: "2039-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code,
      name: `Course ${code}`,
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    return courseRes.body.data.id;
  }

  describe("POST /notes", () => {
    it("should create an uncategorized note", async () => {
      const res = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Meeting notes",
        content: "# Agenda\n- Intro",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Meeting notes");
      expect(res.body.data.content).toContain("Agenda");
      expect(res.body.data.courseId).toBeNull();
    });

    it("should create a note linked to a course", async () => {
      courseId = await createCourse("NOTE101");

      const res = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "DB notes",
        content: "Normalization",
        courseId,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(courseId);
    });

    it("should reject a note with a nonexistent course", async () => {
      const res = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Ghost course note",
        content: "x",
        courseId: "cuid_xnonexistent",
      });

      expect(res.status).toBe(404);
    });

    it("should reject empty content", async () => {
      const res = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "No body",
        content: "",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /notes", () => {
    it("should list the user's notes with search and course filters", async () => {
      const searchRes = await authRequestJson("get", `${BASE}/notes?search=Normalization`, token);
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data.items.length).toBeGreaterThan(0);
      expect(searchRes.body.data.items[0].title).toBe("DB notes");

      // The search box and the command palette type lowercase; the filter has
      // to match regardless of the case the text was written in.
      const lowerRes = await authRequestJson("get", `${BASE}/notes?search=normalization`, token);
      expect(lowerRes.status).toBe(200);
      expect(lowerRes.body.data.items.length).toBeGreaterThan(0);
      expect(lowerRes.body.data.items[0].title).toBe("DB notes");

      const courseRes = await authRequestJson("get", `${BASE}/notes?courseId=${courseId}`, token);
      expect(courseRes.status).toBe(200);
      expect(courseRes.body.data.items).toHaveLength(1);
      expect(courseRes.body.data.items[0].courseId).toBe(courseId);
    });
  });

  describe("GET /notes/:id", () => {
    it("should return a single note", async () => {
      const created = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Single note",
        content: "hello",
      });

      const res = await authRequestJson("get", `${BASE}/notes/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(created.body.data.id);
    });

    it("should return 404 for a missing note", async () => {
      const res = await authRequestJson("get", `${BASE}/notes/cuid_ghost`, token);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /notes/:id", () => {
    it("should update note title and content", async () => {
      const created = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Before",
        content: "old",
      });

      const res = await authRequestJson("patch", `${BASE}/notes/${created.body.data.id}`, token, {
        title: "After",
        content: "new",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("After");
      expect(res.body.data.content).toBe("new");
    });
  });

  describe("DELETE /notes/:id", () => {
    it("should delete a note", async () => {
      const created = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Doomed",
        content: "bye",
      });

      const res = await authRequestJson("delete", `${BASE}/notes/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);

      const getRes = await authRequestJson("get", `${BASE}/notes/${created.body.data.id}`, token);
      expect(getRes.status).toBe(404);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's note", async () => {
      const other = await registerAndLogin("notes-other@test.com", "Pass123!");
      const otherToken = other.token;

      const mine = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Private",
        content: "secret",
      });

      const res = await authRequestJson("get", `${BASE}/notes/${mine.body.data.id}`, otherToken);
      expect(res.status).toBe(404);

      const patchRes = await authRequestJson("patch", `${BASE}/notes/${mine.body.data.id}`, otherToken, {
        title: "hacked",
      });
      expect(patchRes.status).toBe(404);

      const delRes = await authRequestJson("delete", `${BASE}/notes/${mine.body.data.id}`, otherToken);
      expect(delRes.status).toBe(404);
    });
  });
});