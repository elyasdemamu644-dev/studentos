import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Dashboard Module", () => {
  let token: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("dashboard@test.com", "Pass123!");
    token = auth.token;

    // Create a full hierarchy so the dashboard has something to aggregate
    // Academic year
    const yearRes = await authRequestJson(
      "post",
      `${BASE}/academics/years`,
      token,
      {
        name: "2040-2041",
        startDate: "2040-09-01T00:00:00.000Z",
        endDate: "2041-06-30T00:00:00.000Z",
      },
    );
    const yearId = yearRes.body.data.id;

    // Semester
    const semRes = await authRequestJson(
      "post",
      `${BASE}/academics/semesters`,
      token,
      {
        name: "Fall 2040",
        academicYearId: yearId,
        startDate: "2040-09-01T00:00:00.000Z",
        endDate: "2040-12-15T00:00:00.000Z",
      },
    );
    const semesterId = semRes.body.data.id;

    // Courses
    const course1 = await authRequestJson(
      "post",
      `${BASE}/courses`,
      token,
      {
        code: "CS101",
        name: "Intro to CS",
        credits: 3,
        semesterId: semesterId,
      },
    );

    const course2 = await authRequestJson(
      "post",
      `${BASE}/courses`,
      token,
      {
        code: "MATH201",
        name: "Calculus II",
        credits: 4,
        semesterId: semesterId,
      },
    );

    // Tasks
    await authRequestJson(
      "post",
      `${BASE}/tasks`,
      token,
      {
        title: "CS homework 1",
        type: "HOMEWORK",
        priority: "HIGH",
        status: "TODO",
        courseId: course1.body.data.id,
      },
    );

    await authRequestJson(
      "post",
      `${BASE}/tasks`,
      token,
      {
        title: "CS homework 2",
        type: "HOMEWORK",
        priority: "MEDIUM",
        status: "IN_PROGRESS",
        courseId: course1.body.data.id,
      },
    );

    await authRequestJson(
      "post",
      `${BASE}/tasks`,
      token,
      {
        title: "Math problem set",
        type: "ASSIGNMENT",
        priority: "URGENT",
        status: "TODO",
        courseId: course2.body.data.id,
      },
    );

    await authRequestJson(
      "post",
      `${BASE}/tasks`,
      token,
      {
        title: "Read chapter 5",
        type: "READING",
        priority: "LOW",
        status: "COMPLETED",
        courseId: course2.body.data.id,
      },
    );
  });

  describe("GET /dashboard", () => {
    it("should return aggregated dashboard data", async () => {
      const res = await request(app)
        .get(`${BASE}/dashboard`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const d = res.body.data;

      // Academic years should be present
      expect(d.academicYears).toBeInstanceOf(Array);
      expect(d.academicYears.length).toBeGreaterThan(0);

      // Current academic year
      expect(d.currentAcademicYear).toBeDefined();
      expect(d.currentAcademicYear.name).toBe("2040-2041");

      // Current semester
      expect(d.currentSemester).toBeDefined();
      expect(d.currentSemester.name).toBe("Fall 2040");

      // Course count
      expect(d.courses.total).toBe(2);

      // Task stats
      expect(d.tasks.total).toBe(4);
      expect(d.tasks.byStatus).toBeInstanceOf(Object);
      expect(d.tasks.byStatus.TODO).toBe(2);
      expect(d.tasks.byStatus.IN_PROGRESS).toBe(1);
      expect(d.tasks.byStatus.COMPLETED).toBe(1);
      // byStatus only contains statuses that actually exist for the user, and
      // soft-deleted tasks are excluded from the dashboard entirely.
      expect(d.tasks.byStatus.DELETED).toBeUndefined();
      const statusTotal = Object.values(d.tasks.byStatus as Record<string, number>).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(statusTotal).toBe(d.tasks.total);

      // Priority breakdown
      expect(d.tasks.byPriority).toBeInstanceOf(Object);
      expect(d.tasks.byPriority.HIGH).toBe(1);
      expect(d.tasks.byPriority.MEDIUM).toBe(1);
      expect(d.tasks.byPriority.URGENT).toBe(1);
      expect(d.tasks.byPriority.LOW).toBe(1);

      // Upcoming tasks (without due date = not upcoming)
      expect(d.upcomingTasks).toBeInstanceOf(Array);
      expect(d.upcomingTasks.length).toBeGreaterThanOrEqual(0);

      // Phase 2: expanded dashboard sections
      expect(d.events).toBeDefined();
      expect(d.events.today).toBeInstanceOf(Array);
      expect(d.events.upcoming).toBeInstanceOf(Array);

      expect(d.studySessions).toBeDefined();
      expect(d.studySessions.todayMinutes).toBeTypeOf("number");
      expect(d.studySessions.todayCount).toBeTypeOf("number");
      expect(d.studySessions.recent).toBeInstanceOf(Array);

      expect(d.activeGoals).toBeInstanceOf(Array);
      expect(d.recentNotes).toBeInstanceOf(Array);
      expect(d.recentGrades).toBeInstanceOf(Array);
      expect(d.notifications.unreadCount).toBeTypeOf("number");
    });

    it("should return empty dashboard for new user", async () => {
      const auth = await registerAndLogin("empty-dash@test.com", "Pass123!");

      const res = await request(app)
        .get(`${BASE}/dashboard`)
        .set("Authorization", `Bearer ${auth.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const d = res.body.data;
      expect(d.courses.total).toBe(0);
      expect(d.tasks.total).toBe(0);
      expect(d.tasks.byStatus).toEqual({});
      expect(d.tasks.byPriority).toEqual({});
      expect(d.academicYears.length).toBe(0);
      expect(d.currentAcademicYear).toBeNull();
      expect(d.currentSemester).toBeNull();
      expect(d.upcomingTasks).toEqual([]);
    });
  });
});
