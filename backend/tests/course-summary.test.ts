import { describe, it, expect, beforeAll } from "vitest";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

/**
 * GET /courses/:id/summary — the cross-system rollup that powers the course
 * detail page. It must aggregate only the requesting user's records.
 */
describe("GET /courses/:id/summary", () => {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  let token: string;
  let userId: string;
  let courseId: string;
  let otherCourseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("course-summary@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    // Create the academic structure through the API so ownership is realistic.
    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2035-2036",
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2036-08-31T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      academicYearId: yearRes.body.data.id,
      name: "Fall 2035",
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2035-12-20T00:00:00.000Z",
    });
    const semesterId = semRes.body.data.id;

    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "CS350",
      name: "Database Systems",
      credits: 4,
      semesterId,
    });
    courseId = courseRes.body.data.id;

    // A second course for the same user, used to prove the rollup is scoped.
    const otherRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "CS360",
      name: "Operating Systems",
      credits: 3,
      semesterId,
    });
    otherCourseId = otherRes.body.data.id;

    const now = Date.now();

    await prisma.task.createMany({
      data: [
        {
          userId,
          courseId,
          title: "Normalization exercise",
          status: "COMPLETED",
          priority: "HIGH",
        },
        {
          userId,
          courseId,
          title: "Query optimization lab",
          status: "IN_PROGRESS",
          priority: "URGENT",
          dueDate: new Date(now - 2 * dayMs),
        },
        {
          userId,
          courseId,
          title: "ER diagram",
          status: "TODO",
          priority: "MEDIUM",
          dueDate: new Date(now + 4 * dayMs),
        },
        {
          userId,
          courseId: otherCourseId,
          title: "Belady anomaly writeup",
          status: "TODO",
        },
      ],
    });

    await prisma.event.createMany({
      data: [
        {
          userId,
          courseId,
          title: "Midterm Exam",
          type: "EXAM",
          startAt: new Date(now + 5 * dayMs),
          endAt: new Date(now + 5 * dayMs + 2 * hourMs),
          location: "Hall B",
        },
        {
          userId,
          courseId,
          title: "Final Exam",
          type: "EXAM",
          startAt: new Date(now + 60 * dayMs),
          endAt: new Date(now + 60 * dayMs + 3 * hourMs),
        },
        {
          userId,
          courseId,
          title: "Lecture",
          type: "CLASS",
          startAt: new Date(now + 1 * dayMs),
          endAt: new Date(now + 1 * dayMs + hourMs),
        },
        {
          userId,
          courseId: otherCourseId,
          title: "OS Midterm",
          type: "EXAM",
          startAt: new Date(now + 2 * dayMs),
        },
      ],
    });

    await prisma.note.createMany({
      data: [
        { userId, courseId, title: "B+ tree notes", content: "indexing" },
        { userId, courseId, title: "Transaction isolation", content: "2PL" },
        { userId, courseId: otherCourseId, title: "Deadlocks", content: "wait-for" },
      ],
    });

    await prisma.resource.createMany({
      data: [
        {
          userId,
          courseId,
          title: "SQL slides",
          url: "https://example.com/sql-slides",
          resourceType: "SLIDES",
        },
        {
          userId,
          courseId,
          title: "Normalization guide",
          url: "https://example.com/normalization",
          resourceType: "PDF",
        },
        {
          userId,
          courseId: otherCourseId,
          title: "OS syllabus",
          url: "https://example.com/os",
          resourceType: "PDF",
        },
      ],
    });

    await prisma.grade.createMany({
      data: [
        { userId, courseId, title: "Quiz 1", score: 18, maxScore: 20, weight: 20, type: "QUIZ" },
        { userId, courseId, title: "Midterm", score: 42, maxScore: 50, weight: 30, type: "EXAM" },
        // Unscored entry must not affect the average.
        { userId, courseId, title: "Project", type: "PROJECT" },
        { userId, courseId: otherCourseId, title: "OS quiz", score: 10, maxScore: 10, type: "QUIZ" },
      ],
    });

    await prisma.studySession.createMany({
      data: [
        {
          userId,
          courseId,
          topic: "Normalization",
          startedAt: new Date(now - 3 * dayMs),
          endedAt: new Date(now - 3 * dayMs + 45 * 60 * 1000),
          durationMinutes: 45,
        },
        {
          userId,
          courseId,
          topic: "Joins",
          startedAt: new Date(now - dayMs),
          endedAt: new Date(now - dayMs + 30 * 60 * 1000),
          durationMinutes: 30,
        },
        {
          userId,
          courseId: otherCourseId,
          topic: "Scheduling",
          startedAt: new Date(now - dayMs),
          durationMinutes: 90,
        },
      ],
    });

    // Goals are user-level; the summary links them by title match on code/name.
    await prisma.goal.createMany({
      data: [
        { userId, title: "Ace CS350 this term", status: "ACTIVE", progress: 40 },
        { userId, title: "Unrelated hobby goal", status: "ACTIVE", progress: 10 },
      ],
    });
  });

  it("returns the course identity and scoped task rollup", async () => {
    const res = await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const s = res.body.data;
    expect(s.course.id).toBe(courseId);
    expect(s.course.code).toBe("CS350");

    // 3 tasks belong to this course; the 4th belongs to the other course.
    expect(s.tasks.total).toBe(3);
    expect(s.tasks.completed).toBe(1);
    expect(s.tasks.open).toBe(2);
    expect(s.tasks.overdue).toBe(1);
    expect(s.tasks.progress).toBe(33); // 1/3
    expect(s.tasks.byStatus).toEqual({ COMPLETED: 1, IN_PROGRESS: 1, TODO: 1 });
  });

  it("lists upcoming events and reports exam counts", async () => {
    const s = (await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, token)).body.data;

    // Only future events for this course, soonest first, capped at 5.
    const titles = s.events.upcoming.map((e: { title: string }) => e.title);
    expect(titles).toEqual(["Lecture", "Midterm Exam", "Final Exam"]);

    expect(s.events.examCount).toBe(2);
    expect(s.nextExam.title).toBe("Midterm Exam");
    expect(s.nextExam.location).toBe("Hall B");
  });

  it("aggregates notes, resources and study time for this course only", async () => {
    const s = (await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, token)).body.data;

    expect(s.notes.total).toBe(2);
    expect(s.resources.total).toBe(2);
    expect(s.study.sessions).toBe(2);
    expect(s.study.totalMinutes).toBe(75);
  });

  it("computes a weighted grade average and ignores unscored entries", async () => {
    const s = (await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, token)).body.data;

    expect(s.grades.total).toBe(3);
    expect(s.grades.scored).toBe(2);

    // Weighted over the two scored entries: (90*20 + 84*30) / 50 = 86.4
    expect(s.grades.average).toBe(86);
    expect(s.grades.recent).toHaveLength(3);
  });

  it("surfaces goals related to the course by title match", async () => {
    const s = (await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, token)).body.data;

    expect(s.goals.relatedActive).toBe(1);
  });

  it("returns null progress and average for a course with no data", async () => {
    const res = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "EMPTY1",
      name: "Empty Course",
    });
    const emptyId = res.body.data.id;

    const s = (await authRequestJson("get", `${BASE}/courses/${emptyId}/summary`, token)).body.data;

    expect(s.tasks.total).toBe(0);
    expect(s.tasks.progress).toBeNull();
    expect(s.grades.average).toBeNull();
    expect(s.nextExam).toBeNull();
    expect(s.study.totalMinutes).toBe(0);
  });

  it("does not leak another user's course summary", async () => {
    const other = await registerAndLogin("course-summary-other@test.com", "Pass123!");

    const res = await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, other.token);
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await authRequestJson("get", `${BASE}/courses/${courseId}/summary`, "");
    expect(res.status).toBe(401);
  });
});
