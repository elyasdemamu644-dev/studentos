import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Resources Module", () => {
  let token: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("resources@test.com", "Pass123!");
    token = auth.token;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2038-2039",
      startDate: "2038-09-01T00:00:00.000Z",
      endDate: "2039-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2038",
      academicYearId: yearRes.body.data.id,
      startDate: "2038-09-01T00:00:00.000Z",
      endDate: "2038-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "RES101",
      name: "Research Methods",
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;
  });

  describe("POST /resources", () => {
    it("should create a URL resource", async () => {
      const res = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Prisma docs",
        url: "https://www.prisma.io/docs",
        storageType: "URL",
        resourceType: "LINK",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.url).toBe("https://www.prisma.io/docs");
      expect(res.body.data.storageType).toBe("URL");
    });

    it("should link a resource to a course", async () => {
      const res = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Lecture slides",
        url: "https://example.org/slides.pdf",
        storageType: "URL",
        resourceType: "SLIDES",
        courseId,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(courseId);
    });

    it("should reject UPLOAD storage type (S3 not implemented yet)", async () => {
      const res = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Uploaded file",
        storageType: "UPLOAD",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject URL storage without a url", async () => {
      const res = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "No url",
        storageType: "URL",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /resources", () => {
    it("should list resources and apply course + type filters", async () => {
      const res = await authRequestJson("get", `${BASE}/resources?courseId=${courseId}&resourceType=SLIDES`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].resourceType).toBe("SLIDES");
    });

    it("should search resources by title keyword", async () => {
      const res = await authRequestJson("get", `${BASE}/resources?search=Prisma`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe("PATCH /resources/:id", () => {
    it("should update resource metadata", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Old title",
        url: "https://example.org/a",
        storageType: "URL",
      });

      const res = await authRequestJson("patch", `${BASE}/resources/${created.body.data.id}`, token, {
        title: "New title",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("New title");
    });

    it("should reject switching to UPLOAD", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Stable",
        url: "https://example.org/b",
        storageType: "URL",
      });

      const res = await authRequestJson("patch", `${BASE}/resources/${created.body.data.id}`, token, {
        storageType: "UPLOAD",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /resources/:id", () => {
    it("should delete a resource", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Doomed",
        url: "https://example.org/d",
        storageType: "URL",
      });

      const res = await authRequestJson("delete", `${BASE}/resources/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's resource", async () => {
      const other = await registerAndLogin("resources-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Private",
        url: "https://example.org/private",
        storageType: "URL",
      });

      const res = await authRequestJson("get", `${BASE}/resources/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });
});