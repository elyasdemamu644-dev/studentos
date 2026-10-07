import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

describe("Courses Module — StudentOS MVP", () => {
  let accessToken: string;
  let userId: string;
  let anotherAccessToken: string;
  let academicYearId: string;
  let semesterId: string;
  let anotherAcademicYearId: string;
  let courseId: string;

  beforeAll(async () => {
    const user = await registerAndLogin({
      email: "courses@studentos.test",
      password: "SafePass1!",
    });
    accessToken = user.accessToken;
    userId = user.user.id;

    const anotherUser = await registerAndLogin({
      email: "courses-other@studentos.test",
      password: "SafePass1!",
    });
    anotherAccessToken = anotherUser.accessToken;

    // Another user's academic year
    const anotherAY = await authRequestJson(anotherAccessToken)
      .post(`${BASE}/academics/academic-years`)
      .send({
        name: "2026 / 2027 — Other",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
      });
    anotherAcademicYearId = anotherAY.data.id;

    // Primary user's academic year
    const ay = await authRequestJson(accessToken)
      .post(`${BASE}/academics/academic-years`)
      .send({
        name: "2026 / 2027",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
      });
    academicYearId = ay.data.id;

    // Primary user's semester
    const sem = await authRequestJson(accessToken)
      .post(`${BASE}/academics/semesters`)
      .send({
        academicYearId,
        name: "Semester 1",
        startDate: "2026-09-01",
        endDate: "2026-12-31",
      });
    semesterId = sem.data.id;
  });

  // ── Create ─────────────────────────────────────────────────────
  describe("POST /courses", () => {
    it("creates a course in the user's semester", async () => {
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId,
          name: "Database Systems",
          code: "CS-301",
          credits: 5,
          instructor: "Dr. Smith",
        })
        .expect(201);

      courseId = res.data.id;
      expect(res.data.name).toBe("Database Systems");
      expect(res.data.code).toBe("CS-301");
      expect(res.data.credits).toBe(5);
      expect(res.data.semesterId).toBe(semesterId);
      expect(res.data.instructor).toBe("Dr. Smith");
    });

    it("uppercases the course code automatically", async () => {
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId,
          name: "Lowercase Code",
          code: "cs-404",
        })
        .expect(201);

      expect(res.data.code).toBe("CS-404");
    });

    it("persists the nullable payload sent by the course form", async () => {
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          name: "Frontend Minimum Course",
          code: null,
          credits: null,
          instructor: null,
          semesterId: null,
          description: null,
        })
        .expect(201);

      expect(res.data.success).toBe(true);
      expect(res.data.name).toBe("Frontend Minimum Course");
      expect(res.data.code).toBeNull();
      expect(res.data.credits).toBeNull();
      expect(res.data.instructor).toBeNull();
      expect(res.data.semesterId).toBeNull();
      expect(res.data.description).toBeNull();
      expect(res.data.semester).toBeNull();
      expect(res.data.status).toBe("ACTIVE");

      const persisted = await prisma.course.findUnique({
        where: { id: res.data.id },
      });
      expect(persisted).toMatchObject({
        userId,
        name: "Frontend Minimum Course",
        code: null,
        credits: null,
        instructor: null,
        semesterId: null,
        description: null,
        status: "ACTIVE",
      });
    });

    it("rejects creation when semester belongs to another user", async () => {
      await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId: "fake-semester-for-test",
          name: "Intruder",
          code: "CS-999",
        })
        .expect(404);
    });

    it("validates required fields without persisting the course", async () => {
      const countBefore = await prisma.course.count({ where: { userId } });
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          name: "",
          code: null,
          credits: null,
          instructor: null,
          semesterId: null,
          description: null,
        })
        .expect(400);

      expect(res.data.success).toBe(false);
      expect(res.data.error.code).toBe("VALIDATION_ERROR");
      expect(await prisma.course.count({ where: { userId } })).toBe(countBefore);
    });
  });

  // ── List ───────────────────────────────────────────────────────
  describe("GET /courses", () => {
    it("lists only the current user's courses", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/courses`)
        .expect(200);

      expect(res.data.data).toHaveLength(3);
      expect(res.data.data[0].name).toBe("Frontend Minimum Course");
    });

    it("returns empty list for a new user with no courses", async () => {
      const brandNew = await registerAndLogin({
        email: "courses-empty@studentos.test",
        password: "SafePass1!",
      });
      const res = await authRequestJson(brandNew.accessToken)
        .get(`${BASE}/courses`)
        .expect(200);

      expect(res.data.data).toHaveLength(0);
    });
  });

  // ── Get by ID ──────────────────────────────────────────────────
  describe("GET /courses/:id", () => {
    it("returns the course when owned by the user", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/courses/${courseId}`)
        .expect(200);

      expect(res.data.id).toBe(courseId);
      expect(res.data.name).toBe("Database Systems");
    });

    it("returns 404 for another user's course", async () => {
      // Create a course as another user
      const anotherSem = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId: anotherAcademicYearId,
          name: "Other Semester",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        });

      const otherCourse = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId: anotherSem.data.id,
          name: "Other User's Course",
          code: "CS-601",
        });

      await authRequestJson(accessToken)
        .get(`${BASE}/courses/${otherCourse.data.id}`)
        .expect(404);
    });

    it("returns 404 for nonexistent id", async () => {
      await authRequestJson(accessToken)
        .get(`${BASE}/courses/nonexistent-id`)
        .expect(404);
    });
  });

  // ── Update ─────────────────────────────────────────────────────
  describe("PATCH /courses/:id", () => {
    it("updates course fields", async () => {
      const res = await authRequestJson(accessToken)
        .patch(`${BASE}/courses/${courseId}`)
        .send({ name: "Advanced Database Systems", credits: 6 })
        .expect(200);

      expect(res.data.name).toBe("Advanced Database Systems");
      expect(res.data.credits).toBe(6);
    });

    it("rejects updating another user's course", async () => {
      // Use the other course created in the GET test
      const anotherSem = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId: anotherAcademicYearId,
          name: "Other Semester 2",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        });

      const otherCourse = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId: anotherSem.data.id,
          name: "Other Course",
          code: "CS-701",
        });

      await authRequestJson(accessToken)
        .patch(`${BASE}/courses/${otherCourse.data.id}`)
        .send({ name: "Hacked Name" })
        .expect(404);
    });

    it("returns 404 for nonexistent id", async () => {
      await authRequestJson(accessToken)
        .patch(`${BASE}/courses/nonexistent-id`)
        .send({ name: "Ghost" })
        .expect(404);
    });
  });

  // ── Delete ─────────────────────────────────────────────────────
  describe("DELETE /courses/:id", () => {
    it("deletes the course when owned by the user", async () => {
      // Create a disposable course
      const toDelete = await authRequestJson(accessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId,
          name: "To Delete",
          code: "CS-808",
        });

      await authRequestJson(accessToken)
        .delete(`${BASE}/courses/${toDelete.data.id}`)
        .expect(200);

      await authRequestJson(accessToken)
        .get(`${BASE}/courses/${toDelete.data.id}`)
        .expect(404);
    });

    it("returns 404 for another user's course", async () => {
      const anotherSem = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId: anotherAcademicYearId,
          name: "Delete Test Semester",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        });

      const otherCourse = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/courses`)
        .send({
          semesterId: anotherSem.data.id,
          name: "Protected",
          code: "CS-901",
        });

      await authRequestJson(accessToken)
        .delete(`${BASE}/courses/${otherCourse.data.id}`)
        .expect(404);
    });
  });

  // ── Semester chain validation on update ────────────────────────
  describe("Semester chain validation on course update", () => {
    it("rejects changing to a semester not owned by the user", async () => {
      const anotherSem = await authRequestJson(anotherAccessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId: anotherAcademicYearId,
          name: "Unauthorized Semester",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        });

      await authRequestJson(accessToken)
        .patch(`${BASE}/courses/${courseId}`)
        .send({ semesterId: anotherSem.data.id })
        .expect(404);
    });
  });
});
