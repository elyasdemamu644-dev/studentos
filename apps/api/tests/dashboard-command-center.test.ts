import { describe, it, expect, beforeAll } from "vitest";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

/**
 * The dashboard is the command center: it must surface actionable state from
 * every academic system. These tests pin the cross-system contract using data
 * anchored to "now" so the time-based buckets are deterministic.
 */
describe("Dashboard command center", () => {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  let token: string;
  let userId: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("dash-cc@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "Now Year",
      startDate: new Date(Date.now() - 60 * dayMs).toISOString(),
      endDate: new Date(Date.now() + 300 * dayMs).toISOString(),
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      academicYearId: yearRes.body.data.id,
      name: "Now Semester",
      startDate: new Date(Date.now() - 30 * dayMs).toISOString(),
      endDate: new Date(Date.now() + 120 * dayMs).toISOString(),
    });

    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "CC101",
      name: "Command Center Course",
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;

    const now = Date.now();
    // Local midnight boundaries so "due today" lands in the right bucket.
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const atNoonToday = new Date(startOfToday.getTime() + 12 * hourMs);

    await prisma.task.createMany({
      data: [
        {
          userId,
          courseId,
          title: "Overdue lab report",
          status: "TODO",
          priority: "URGENT",
          dueDate: new Date(now - 2 * dayMs),
        },
        {
          userId,
          courseId,
          title: "Due later today",
          status: "IN_PROGRESS",
          priority: "HIGH",
          dueDate: atNoonToday,
        },
        {
          userId,
          courseId,
          title: "Due next week",
          status: "TODO",
          priority: "MEDIUM",
          dueDate: new Date(now + 5 * dayMs),
        },
        {
          userId,
          courseId,
          title: "No due date task",
          status: "TODO",
          priority: "LOW",
        },
        {
          userId,
          courseId,
          title: "Finished reading",
          status: "COMPLETED",
          priority: "LOW",
          dueDate: new Date(now - dayMs),
        },
      ],
    });

    await prisma.event.createMany({
      data: [
        {
          userId,
          courseId,
          title: "Today lecture",
          type: "CLASS",
          startAt: new Date(startOfToday.getTime() + 10 * hourMs),
          endAt: new Date(startOfToday.getTime() + 11 * hourMs),
          location: "Room 1",
        },
        {
          userId,
          courseId,
          title: "Upcoming midterm",
          type: "EXAM",
          startAt: new Date(now + 3 * dayMs),
          endAt: new Date(now + 3 * dayMs + 2 * hourMs),
          location: "Hall C",
        },
        {
          userId,
          courseId,
          title: "Later exam",
          type: "EXAM",
          startAt: new Date(now + 20 * dayMs),
          endAt: new Date(now + 20 * dayMs + 2 * hourMs),
        },
      ],
    });

    await prisma.grade.createMany({
      data: [
        { userId, courseId, title: "Quiz", score: 15, maxScore: 20, weight: 25, type: "QUIZ" },
        { userId, courseId, title: "Assignment", score: 8, maxScore: 10, weight: 75, type: "ASSIGNMENT" },
      ],
    });

    await prisma.note.create({
      data: { userId, courseId, title: "Summary note", content: "body" },
    });
    await prisma.resource.createMany({
      data: [
        { userId, courseId, title: "Link 1", url: "https://example.com/1", resourceType: "LINK" },
        { userId, courseId, title: "Link 2", url: "https://example.com/2", resourceType: "PDF" },
      ],
    });

    await prisma.studySession.createMany({
      data: [
        {
          userId,
          courseId,
          topic: "Morning review",
          startedAt: new Date(startOfToday.getTime() + 8 * hourMs),
          endedAt: new Date(startOfToday.getTime() + 9 * hourMs),
          durationMinutes: 60,
        },
        {
          userId,
          courseId,
          topic: "Evening review",
          startedAt: new Date(startOfToday.getTime() + 18 * hourMs),
          endedAt: new Date(startOfToday.getTime() + 18 * hourMs + 30 * 60 * 1000),
          durationMinutes: 30,
        },
      ],
    });

    const goal = await prisma.goal.create({
      data: { userId, title: "Finish term strong", status: "ACTIVE", progress: 60 },
    });
    await prisma.goalMilestone.createMany({
      data: [
        { goalId: goal.id, title: "Milestone A", status: "COMPLETED", position: 1 },
        { goalId: goal.id, title: "Milestone B", status: "TODO", position: 2 },
      ],
    });

    await prisma.notification.createMany({
      data: [
        { userId, title: "Unread one", message: "m1", type: "GENERAL", status: "UNREAD" },
        { userId, title: "Unread two", message: "m2", type: "GENERAL", status: "UNREAD" },
        { userId, title: "Already read", message: "m3", type: "GENERAL", status: "READ" },
      ],
    });
  });

  async function fetchDashboard() {
    const res = await authRequestJson("get", `${BASE}/dashboard`, token);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  it("summarises courses with task progress and grade average", async () => {
    const d = await fetchDashboard();

    expect(d.courses.total).toBe(1);
    expect(d.courses.active).toBe(1);

    const course = d.courses.recent.find((c: { id: string }) => c.id === courseId);
    expect(course.code).toBe("CC101");
    expect(course.taskTotal).toBe(5);
    expect(course.taskCompleted).toBe(1);
    expect(course.taskProgress).toBe(20);
    // Weighted: (75*25 + 80*75) / 100 = 78.75 -> 79
    expect(course.gradeAverage).toBe(79);
    expect(course.gradeCount).toBe(2);
  });

  it("counts open, overdue and due-today tasks", async () => {
    const d = await fetchDashboard();

    expect(d.tasks.total).toBe(5);
    expect(d.tasks.overdue).toBe(1);
    expect(d.tasks.dueToday).toBe(1);
  });

  it("separates upcoming from overdue tasks and orders by due date", async () => {
    const d = await fetchDashboard();

    // Overdue list excludes completed tasks.
    expect(d.overdueTasks.map((t: { title: string }) => t.title)).toEqual([
      "Overdue lab report",
    ]);

    // Upcoming excludes overdue, undated and completed tasks.
    const upcomingTitles = d.upcomingTasks.map((t: { title: string }) => t.title);
    expect(upcomingTitles).toEqual(["Due later today", "Due next week"]);

    const withCourse = d.upcomingTasks.find((t: { title: string }) => t.title === "Due later today");
    expect(withCourse.course.code).toBe("CC101");
  });

  it("reports upcoming exams with a countdown", async () => {
    const d = await fetchDashboard();

    expect(d.exams.upcoming.map((e: { title: string }) => e.title)).toEqual([
      "Upcoming midterm",
      "Later exam",
    ]);
    expect(d.exams.nextInDays).toBe(3);

    // Today's events are separate from future ones.
    expect(d.events.today.map((e: { title: string }) => e.title)).toEqual(["Today lecture"]);
    expect(d.events.upcoming.map((e: { title: string }) => e.title)).toEqual([
      "Upcoming midterm",
      "Later exam",
    ]);
  });

  it("aggregates study time for today and the week", async () => {
    const d = await fetchDashboard();

    expect(d.studySessions.todayCount).toBe(2);
    expect(d.studySessions.todayMinutes).toBe(90);
    expect(d.studySessions.weekMinutes).toBeGreaterThanOrEqual(90);
    expect(d.studySessions.recent).toHaveLength(2);
  });

  it("includes active goals with milestone rollups", async () => {
    const d = await fetchDashboard();

    expect(d.activeGoals).toHaveLength(1);
    expect(d.activeGoals[0].title).toBe("Finish term strong");
    expect(d.activeGoals[0].progress).toBe(60);
    expect(d.activeGoals[0].milestoneTotal).toBe(2);
    expect(d.activeGoals[0].milestoneCompleted).toBe(1);
  });

  it("exposes resource totals and notification badges", async () => {
    const d = await fetchDashboard();

    expect(d.resources.total).toBe(2);
    expect(d.notifications.unreadCount).toBe(2);
    expect(d.notifications.recent).toHaveLength(3);
    expect(d.recentNotes.map((n: { title: string }) => n.title)).toContain("Summary note");
    expect(d.recentGrades).toHaveLength(2);
  });

  it("merges cross-system activity newest-first and caps the feed", async () => {
    const d = await fetchDashboard();

    expect(d.activity.length).toBeGreaterThan(0);
    expect(d.activity.length).toBeLessThanOrEqual(8);

    // Newest first.
    const timestamps = d.activity.map((a: { at: string }) => a.at);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);

    // Feeds come from more than one system.
    const kinds = new Set(d.activity.map((a: { kind: string }) => a.kind));
    expect(kinds.size).toBeGreaterThan(1);
    for (const item of d.activity) {
      expect(item.title).toBeTruthy();
    }
  });

  it("returns zeroed command-center sections for a brand new user", async () => {
    const fresh = await registerAndLogin("dash-cc-empty@test.com", "Pass123!");
    const res = await authRequestJson("get", `${BASE}/dashboard`, fresh.token);
    const d = res.body.data;

    expect(d.courses.total).toBe(0);
    expect(d.courses.recent).toEqual([]);
    expect(d.tasks.overdue).toBe(0);
    expect(d.tasks.dueToday).toBe(0);
    expect(d.overdueTasks).toEqual([]);
    expect(d.exams.upcoming).toEqual([]);
    expect(d.exams.nextInDays).toBeNull();
    expect(d.studySessions.todayMinutes).toBe(0);
    expect(d.studySessions.weekMinutes).toBe(0);
    expect(d.activeGoals).toEqual([]);
    expect(d.resources.total).toBe(0);
    expect(d.notifications.unreadCount).toBe(0);
    expect(d.notifications.recent).toEqual([]);
    expect(d.activity).toEqual([]);
  });
});
