import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin } from "./helpers";

const BASE = "/api/v1";

describe("Cross-User Isolation", () => {
  let aliceToken: string;
  let bobToken: string;
  let aliceUserId: string;
  let bobUserId: string;

  beforeAll(async () => {
    const alice = await registerAndLogin("alice@test.com", "Pass123!");
    aliceToken = alice.accessToken;
    aliceUserId = alice.user.id;

    const bob = await registerAndLogin("bob@test.com", "Pass123!");
    bobToken = bob.accessToken;
    bobUserId = bob.user.id;
  });

  describe("Task ownership", () => {
    let aliceTaskId: string;

    beforeAll(async () => {
      // Alice creates a task
      const res = await request(app)
        .post(`${BASE}/tasks`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ title: "Alice's secret task", type: "OTHER" });

      aliceTaskId = res.body.data.id;
    });

    it("should let Alice see her own task", async () => {
      const res = await request(app)
        .get(`${BASE}/tasks/${aliceTaskId}`)
        .set("Authorization", `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Alice's secret task");
    });

    it("should NOT let Bob see Alice's task", async () => {
      const res = await request(app)
        .get(`${BASE}/tasks/${aliceTaskId}`)
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(404);
    });

    it("should NOT let Bob update Alice's task", async () => {
      const res = await request(app)
        .patch(`${BASE}/tasks/${aliceTaskId}`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ title: "Hacked by Bob" });

      expect(res.status).toBe(404);
    });

    it("should NOT let Bob delete Alice's task", async () => {
      const res = await request(app)
        .delete(`${BASE}/tasks/${aliceTaskId}`)
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(404);
    });

    it("should NOT let Bob complete Alice's task", async () => {
      const res = await request(app)
        .post(`${BASE}/tasks/${aliceTaskId}/complete`)
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("Course ownership", () => {
    let aliceCourseId: string;

    beforeAll(async () => {
      // Alice creates a semester + year + course
      const yearRes = await request(app)
        .post(`${BASE}/academics/years`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          name: "2050-2051",
          startDate: "2050-09-01T00:00:00.000Z",
          endDate: "2051-06-30T00:00:00.000Z",
        });

      const semRes = await request(app)
        .post(`${BASE}/academics/semesters`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          name: "Fall 2050",
          academicYearId: yearRes.body.data.id,
          startDate: "2050-09-01T00:00:00.000Z",
          endDate: "2050-12-15T00:00:00.000Z",
        });

      const courseRes = await request(app)
        .post(`${BASE}/courses`)
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({
          code: "ALICE101",
          name: "Alice's Course",
          credits: 3,
          semesterId: semRes.body.data.id,
        });

      aliceCourseId = courseRes.body.data.id;
    });

    it("should let Alice see her own course", async () => {
      const res = await request(app)
        .get(`${BASE}/courses/${aliceCourseId}`)
        .set("Authorization", `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.code).toBe("ALICE101");
    });

    it("should NOT let Bob see Alice's course", async () => {
      const res = await request(app)
        .get(`${BASE}/courses/${aliceCourseId}`)
        .set("Authorization", `Bearer ${bobToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("Dashboard isolation", () => {
    it("Alice's dashboard should not include Bob's data", async () => {
      // Bob creates a course and task
      const bobYearRes = await request(app)
        .post(`${BASE}/academics/years`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          name: "2060-2061",
          startDate: "2060-09-01T00:00:00.000Z",
          endDate: "2061-06-30T00:00:00.000Z",
        });

      const bobSemRes = await request(app)
        .post(`${BASE}/academics/semesters`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          name: "Spring 2060",
          academicYearId: bobYearRes.body.data.id,
          startDate: "2060-01-15T00:00:00.000Z",
          endDate: "2060-05-15T00:00:00.000Z",
        });

      await request(app)
        .post(`${BASE}/courses`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({
          code: "BOB101",
          name: "Bob's Course",
          credits: 3,
          semesterId: bobSemRes.body.data.id,
        });

      await request(app)
        .post(`${BASE}/tasks`)
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ title: "Bob's task", type: "OTHER" });

      // Alice's dashboard
      const aliceDash = await request(app)
        .get(`${BASE}/dashboard`)
        .set("Authorization", `Bearer ${aliceToken}`);

      expect(aliceDash.status).toBe(200);
      // Alice owns exactly one course and one task, so her dashboard must
      // surface her own records and none of Bob's.
      expect(aliceDash.body.data.courses.total).toBe(1);
      expect(aliceDash.body.data.tasks.total).toBe(1);

      const courseCodes: string[] = aliceDash.body.data.courses.recent.map(
        (c: { code: string | null }) => c.code,
      );
      const activityTitles: string[] = aliceDash.body.data.activity.map(
        (a: { title: string }) => a.title,
      );
      expect(courseCodes).toContain("ALICE101");
      expect(courseCodes).not.toContain("BOB101");
      expect(activityTitles).toContain("Alice's secret task");
      expect(activityTitles).not.toContain("Bob's task");
    });
  });
});
