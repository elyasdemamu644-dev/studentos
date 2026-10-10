import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { prisma, registerAndLogin } from "./helpers";

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

  // ────────────────────────────────────────────
  // IDOR sweep — nested children and action endpoints
  // ────────────────────────────────────────────
  //
  // The sweep above covers top-level records. These surfaces hang off a parent
  // id or are verbs on an id, so a module that checks the parent but forgets to
  // scope the child (or the reverse) would slip through. Every foreign probe
  // must answer 404 — never 403, never a 200 with a "failed" payload.

  describe("IDOR sweep — nested resources and action endpoints", () => {
    let taskId = "";
    let subtaskId = "";
    let tagId = "";
    let goalId = "";
    let milestoneId = "";
    let conversationId = "";
    let planId = "";
    let entryId = "";
    let notificationId = "";
    let courseId = "";
    let sessionId = "";
    let connectionId = "";

    beforeAll(async () => {
      const alice = (
        method: "get" | "post" | "patch",
        path: string,
        body?: unknown,
      ) => {
        const req = request(app)[method](`${BASE}${path}`).set(
          "Authorization",
          `Bearer ${aliceToken}`,
        );
        return body === undefined ? req : req.send(body);
      };
      const year = await alice("post", "/academics/years", {
        name: "2090-2091",
        startDate: "2090-09-01",
        endDate: "2091-06-30",
      });
      const semester = await alice("post", "/academics/semesters", {
        name: "Fall 2090",
        academicYearId: year.body.data.id,
        startDate: "2090-09-01",
        endDate: "2090-12-20",
      });
      const course = await alice("post", "/courses", {
        code: "NEST101",
        name: "Nested course",
        credits: 3,
        semesterId: semester.body.data.id,
      });
      courseId = course.body.data.id;

      const task = await alice("post", "/tasks", { title: "Nested task", type: "OTHER" });
      taskId = task.body.data.id;

      const subtask = await alice("post", `/tasks/${taskId}/subtasks`, { title: "Nested subtask" });
      subtaskId = subtask.body.data.id;

      const tag = await alice("post", `/tasks/${taskId}/tags`, { name: "nested-tag" });
      tagId = tag.body.data.id;

      const goal = await alice("post", "/goals", { title: "Nested goal" });
      goalId = goal.body.data.id;

      const milestone = await alice("post", `/goals/${goalId}/milestones`, { title: "Nested milestone" });
      milestoneId = milestone.body.data.id;

      const conversation = await alice("post", "/ai/conversations", { title: "Nested chat" });
      conversationId = conversation.body.data.id;
      await alice("post", `/ai/conversations/${conversationId}/messages`, {
        content: "hello there",
        generateReply: false,
      });

      const plan = await alice("post", "/ai/study-plans", {
        title: "Nested plan",
        entries: [{ dayNumber: 1, title: "Day one", durationMinutes: 30 }],
      });
      planId = plan.body.data.id;
      const entries = await alice("get", `/ai/study-plans/${planId}/entries`);
      expect(entries.status, "setup plan entries").toBe(200);
      entryId = entries.body.data[0].id;

      const session = await alice("post", "/study-sessions", {
        startedAt: "2090-04-02T18:00:00.000Z",
        topic: "Nested session",
      });
      sessionId = session.body.data.id;

      // A provider Alice has not used in another describe — (userId, provider)
      // is unique, so re-using "openai" here would collide with the sweep above.
      const connection = await alice("post", "/ai-connections", {
        provider: "gemini",
        credentials: "sk-nested-sweep",
      });
      connectionId = connection.body.data.id;

      // Notifications have no create endpoint — provision one directly.
      const notification = await prisma.notification.create({
        data: {
          userId: aliceUserId,
          title: "Nested notification",
          message: "private",
          type: "GENERAL",
        },
      });
      notificationId = notification.id;
    });

    it("answers 404 for every foreign nested/action probe", async () => {
      const bob = (method: "get" | "post" | "patch" | "delete", path: string, body?: unknown) => {
        const req = request(app)[method](`${BASE}${path}`).set(
          "Authorization",
          `Bearer ${bobToken}`,
        );
        return body === undefined ? req : req.send(body);
      };

      const probes: Array<[string, "get" | "post" | "patch" | "delete", unknown?]> = [
        ["GET subtasks", "get", `/tasks/${taskId}/subtasks`],
        ["POST subtask", "post", `/tasks/${taskId}/subtasks`, { title: "stolen" }],
        ["PATCH subtask", "patch", `/tasks/${taskId}/subtasks/${subtaskId}`, { title: "stolen" }],
        ["DELETE subtask", "delete", `/tasks/${taskId}/subtasks/${subtaskId}`],
        ["GET tags", "get", `/tasks/${taskId}/tags`],
        ["POST tag", "post", `/tasks/${taskId}/tags`, { name: "stolen" }],
        ["PATCH tag", "patch", `/tasks/${taskId}/tags/${tagId}`, { name: "stolen" }],
        ["DELETE tag", "delete", `/tasks/${taskId}/tags/${tagId}`],
        ["GET milestones", "get", `/goals/${goalId}/milestones`],
        ["POST milestone", "post", `/goals/${goalId}/milestones`, { title: "stolen" }],
        ["PATCH milestone", "patch", `/goals/${goalId}/milestones/${milestoneId}`, { title: "stolen" }],
        ["DELETE milestone", "delete", `/goals/${goalId}/milestones/${milestoneId}`],
        ["GET messages", "get", `/ai/conversations/${conversationId}/messages`],
        ["POST message", "post", `/ai/conversations/${conversationId}/messages`, { content: "stolen" }],
        ["GET plan entries", "get", `/ai/study-plans/${planId}/entries`],
        ["PATCH plan entry", "patch", `/ai/study-plans/${planId}/entries/${entryId}`, { title: "stolen" }],
        ["GET notification", "get", `/notifications/${notificationId}`],
        ["PATCH notification", "patch", `/notifications/${notificationId}`, {}],
        ["POST notification read", "post", `/notifications/${notificationId}/read`],
        ["GET course summary", "get", `/courses/${courseId}/summary`],
        ["POST complete session", "post", `/study-sessions/${sessionId}/complete`, {}],
        ["POST activate connection", "post", `/ai-connections/${connectionId}/activate`],
        ["POST test connection", "post", `/ai-connections/${connectionId}/test`, {}],
      ];

      for (const [label, method, path, body] of probes) {
        const res = await bob(method, path, body);
        expect(res.status, `${label} (${method.toUpperCase()} ${path})`).toBe(404);
        expect(res.body.error?.code, label).toBe("NOT_FOUND");
      }
    });

    it("leaves Alice's nested records readable by their owner", async () => {
      const owner = (path: string) =>
        request(app).get(`${BASE}${path}`).set("Authorization", `Bearer ${aliceToken}`);

      const checks = [
        `/tasks/${taskId}/subtasks`,
        `/tasks/${taskId}/tags`,
        `/goals/${goalId}/milestones`,
        `/ai/conversations/${conversationId}/messages`,
        `/ai/study-plans/${planId}/entries`,
        `/notifications/${notificationId}`,
        `/courses/${courseId}/summary`,
      ];

      for (const path of checks) {
        const res = await owner(path);
        expect(res.status, `owner GET ${path}`).toBe(200);
      }
    });

    afterAll(async () => {
      // The dashboard describe below asserts Alice owns *exactly* one course
      // and one task; drop the extra course/task so its counts stay meaningful.
      await request(app)
        .delete(`${BASE}/tasks/${taskId}`)
        .set("Authorization", `Bearer ${aliceToken}`);
      await request(app)
        .delete(`${BASE}/courses/${courseId}`)
        .set("Authorization", `Bearer ${aliceToken}`);
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
