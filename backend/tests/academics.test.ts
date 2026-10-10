import { describe, it, expect, beforeAll } from "vitest";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Academics Module — StudentOS MVP", () => {
  let accessToken: string;
  let anotherAccessToken: string;
  let academicYearId: string;
  let semesterId: string;
  let anotherAcademicYearId: string;

  beforeAll(async () => {
    const user = await registerAndLogin({
      email: "academics@studentos.test",
      password: "SafePass1!",
    });
    accessToken = user.accessToken;

    const anotherUser = await registerAndLogin({
      email: "academics-other@studentos.test",
      password: "SafePass1!",
    });
    anotherAccessToken = anotherUser.accessToken;

    // Another user's academic year for cross-user tests
    const anotherAY = await authRequestJson(anotherAccessToken)
      .post(`${BASE}/academics/academic-years`)
      .send({
        name: "2026 / 2027 — Other User",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
      });
    anotherAcademicYearId = anotherAY.data.id;

    // Create the primary user's academic year
    const ay = await authRequestJson(accessToken)
      .post(`${BASE}/academics/academic-years`)
      .send({
        name: "2026 / 2027",
        startDate: "2026-09-01",
        endDate: "2027-08-31",
      });
    academicYearId = ay.data.id;

    // Create a semester inside it
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

  // ── Academic Years ─────────────────────────────────────────────
  describe("Academic Years", () => {
    it("lists only the current user's academic years", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/academics/academic-years`)
        .expect(200);

      expect(res.data.data).toHaveLength(1);
      expect(res.data.data[0].name).toBe("2026 / 2027");
      expect(res.data.data[0].status).toBe("UPCOMING");
    });

    it("creates an academic year", async () => {
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/academics/academic-years`)
        .send({
          name: "2027 / 2028",
          startDate: "2027-09-01",
          endDate: "2028-08-31",
        })
        .expect(201);

      expect(res.data.data.id).toBeDefined();
      expect(res.data.data.name).toBe("2027 / 2028");
    });

    it("rejects invalid date range", async () => {
      await authRequestJson(accessToken)
        .post(`${BASE}/academics/academic-years`)
        .send({
          name: "Bad Dates",
          startDate: "2027-09-01",
          endDate: "2027-01-01",
        })
        .expect(400);
    });

    it("gets a single academic year by id", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/academics/academic-years/${academicYearId}`)
        .expect(200);

      expect(res.data.data.id).toBe(academicYearId);
      expect(res.data.data.name).toBe("2026 / 2027");
    });

    it("updates an academic year", async () => {
      const res = await authRequestJson(accessToken)
        .patch(`${BASE}/academics/academic-years/${academicYearId}`)
        .send({ status: "ACTIVE" })
        .expect(200);

      expect(res.data.data.status).toBe("ACTIVE");
    });

    it("deletes an academic year", async () => {
      // Create a disposable AY
      const toDelete = await authRequestJson(accessToken)
        .post(`${BASE}/academics/academic-years`)
        .send({
          name: "To Delete",
          startDate: "2025-09-01",
          endDate: "2026-08-31",
        });
      await authRequestJson(accessToken)
        .delete(`${BASE}/academics/academic-years/${toDelete.data.id}`)
        .expect(200);

      // Verify it's gone
      await authRequestJson(accessToken)
        .get(`${BASE}/academics/academic-years/${toDelete.data.id}`)
        .expect(404);
    });

    it("prevents another user from accessing your academic years", async () => {
      const res = await authRequestJson(anotherAccessToken)
        .get(`${BASE}/academics/academic-years/${academicYearId}`)
        .expect(404);
    });

    it("rejects unknown academic year id", async () => {
      await authRequestJson(accessToken)
        .get(`${BASE}/academics/academic-years/nonexistent-id`)
        .expect(404);
    });
  });

  // ── Semesters ──────────────────────────────────────────────────
  describe("Semesters", () => {
    it("lists semesters within the current user's academic years", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/academics/semesters`)
        .expect(200);

      expect(res.data.data).toHaveLength(1);
      expect(res.data.data[0].name).toBe("Semester 1");
    });

    it("creates a semester", async () => {
      const res = await authRequestJson(accessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId,
          name: "Semester 2",
          startDate: "2027-01-01",
          endDate: "2027-05-31",
        })
        .expect(201);

      expect(res.data.data.id).toBeDefined();
      expect(res.data.data.name).toBe("Semester 2");
      expect(res.data.data.academicYearId).toBe(academicYearId);
    });

    it("rejects semester creation with an academic year not owned by the user", async () => {
      await authRequestJson(accessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId: anotherAcademicYearId,
          name: "Intruder Semester",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        })
        .expect(404);
    });

    it("gets a single semester by id", async () => {
      const res = await authRequestJson(accessToken)
        .get(`${BASE}/academics/semesters/${semesterId}`)
        .expect(200);

      expect(res.data.data.id).toBe(semesterId);
      expect(res.data.data.name).toBe("Semester 1");
    });

    it("updates a semester", async () => {
      const res = await authRequestJson(accessToken)
        .patch(`${BASE}/academics/semesters/${semesterId}`)
        .send({ status: "ACTIVE" })
        .expect(200);

      expect(res.data.data.status).toBe("ACTIVE");
    });

    it("deletes a semester", async () => {
      // Create a disposable semester
      const toDelete = await authRequestJson(accessToken)
        .post(`${BASE}/academics/semesters`)
        .send({
          academicYearId,
          name: "To Delete",
          startDate: "2025-09-01",
          endDate: "2025-12-31",
        });
      await authRequestJson(accessToken)
        .delete(`${BASE}/academics/semesters/${toDelete.data.id}`)
        .expect(200);

      await authRequestJson(accessToken)
        .get(`${BASE}/academics/semesters/${toDelete.data.id}`)
        .expect(404);
    });

    it("prevents another user from accessing your semesters", async () => {
      const res = await authRequestJson(anotherAccessToken)
        .get(`${BASE}/academics/semesters/${semesterId}`)
        .expect(404);
    });
  });
});
