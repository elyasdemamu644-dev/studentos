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

  // ────────────────────────────────────────────
  // IDOR sweep — one representative record per module
  // ────────────────────────────────────────────
  //
  // The per-module suites already cover their own ownership rules; this is the
  // cross-cutting net that fails if any future module forgets to scope by
  // userId. Expected answer everywhere is 404, never 403, so a probe cannot
  // tell "not yours" from "does not exist".

  describe("IDOR sweep across modules", () => {
    interface Owned {
      label: string;
      get: string;
      patch: string;
      delete: string;
      patchBody: Record<string, unknown>;
    }

    const owned: Owned[] = [];

    beforeAll(async () => {
      const post = async (path: string, body: unknown): Promise<string> => {
        const res = await request(app)
          .post(`${BASE}${path}`)
          .set("Authorization", `Bearer ${aliceToken}`)
          .send(body);
        expect(res.status, `setup POST ${path}: ${JSON.stringify(res.body)}`).toBe(201);
        return res.body.data.id as string;
      };

      const noteId = await post("/notes", { title: "Alice note", content: "private" });
      const eventId = await post("/events", {
        title: "Alice exam",
        type: "EXAM",
        startAt: "2035-04-01T09:00:00.000Z",
      });
      const goalId = await post("/goals", { title: "Alice goal" });
      const gradeId = await post("/grades", { title: "Alice grade", score: 5, maxScore: 10 });
      const resourceId = await post("/resources", {
        title: "Alice resource",
        url: "https://example.org/a.pdf",
      });
      const sessionId = await post("/study-sessions", {
        startedAt: "2035-04-02T18:00:00.000Z",
        topic: "Indexing",
      });
      const conversationId = await post("/ai/conversations", { title: "Alice chat" });
      const planId = await post("/ai/study-plans", {
        title: "Alice plan",
        entries: [{ dayNumber: 1, title: "Day one", durationMinutes: 45 }],
      });
      const connectionId = await post("/ai-connections", {
        provider: "openai",
        credentials: "sk-idor-sweep",
      });

      owned.push(
        { label: "note", get: `/notes/${noteId}`, patch: `/notes/${noteId}`, delete: `/notes/${noteId}`, patchBody: { title: "Hacked note" } },
        { label: "event", get: `/events/${eventId}`, patch: `/events/${eventId}`, delete: `/events/${eventId}`, patchBody: { title: "Hacked event" } },
        { label: "goal", get: `/goals/${goalId}`, patch: `/goals/${goalId}`, delete: `/goals/${goalId}`, patchBody: { title: "Hacked goal" } },
        { label: "grade", get: `/grades/${gradeId}`, patch: `/grades/${gradeId}`, delete: `/grades/${gradeId}`, patchBody: { score: 10 } },
        { label: "resource", get: `/resources/${resourceId}`, patch: `/resources/${resourceId}`, delete: `/resources/${resourceId}`, patchBody: { title: "Hacked resource" } },
        { label: "study session", get: `/study-sessions/${sessionId}`, patch: `/study-sessions/${sessionId}`, delete: `/study-sessions/${sessionId}`, patchBody: { topic: "Hacked topic" } },
        { label: "AI conversation", get: `/ai/conversations/${conversationId}`, patch: `/ai/conversations/${conversationId}`, delete: `/ai/conversations/${conversationId}`, patchBody: { title: "Hacked chat" } },
        { label: "AI study plan", get: `/ai/study-plans/${planId}`, patch: `/ai/study-plans/${planId}`, delete: `/ai/study-plans/${planId}`, patchBody: { title: "Hacked plan" } },
        { label: "AI connection", get: `/ai-connections/${connectionId}`, patch: `/ai-connections/${connectionId}`, delete: `/ai-connections/${connectionId}`, patchBody: { enabled: false } },
      );
    });

    it("answers 404 (never 403) for every foreign record, and leaves it intact", async () => {
      for (const record of owned) {
        const withAuth = (method: "get" | "patch" | "delete", path: string, body?: unknown) => {
          const req = request(app)[method](`${BASE}${path}`).set(
            "Authorization",
            `Bearer ${bobToken}`,
          );
          return body === undefined ? req : req.send(body);
        };

        const read = await withAuth("get", record.get);
        expect(read.status, `${record.label} GET`).toBe(404);
        expect(read.body.error.code, `${record.label} GET`).toBe("NOT_FOUND");

        const update = await withAuth("patch", record.patch, record.patchBody);
        expect(update.status, `${record.label} PATCH`).toBe(404);

        const remove = await withAuth("delete", record.delete);
        expect(remove.status, `${record.label} DELETE`).toBe(404);
      }
    });

    it("leaves every record readable by its owner afterwards", async () => {
      for (const record of owned) {
        const res = await request(app)
          .get(`${BASE}${record.get}`)
          .set("Authorization", `Bearer ${aliceToken}`);
        expect(res.status, `${record.label} owner re-read`).toBe(200);
      }
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
