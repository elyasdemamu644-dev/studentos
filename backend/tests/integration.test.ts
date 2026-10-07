import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("End-to-End Student Workflow", () => {
  let token: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("e2e@test.com", "Pass123!");
    token = auth.token;
  });

  it("walks a complete study lifecycle across all Phase 2 modules", async () => {
    // 1. Academics: year → semester → course
    const year = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2033-2034",
      startDate: "2033-09-01T00:00:00.000Z",
      endDate: "2034-06-30T00:00:00.000Z",
    });
    const semester = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2033",
      academicYearId: year.body.data.id,
      startDate: "2033-09-01T00:00:00.000Z",
      endDate: "2033-12-15T00:00:00.000Z",
    });
    const course = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "DB203",
      name: "Databases",
      credits: 4,
      semesterId: semester.body.data.id,
    });
    const courseId = course.body.data.id;

    // 2. Task with subtasks and tags
    const task = await authRequestJson("post", `${BASE}/tasks`, token, {
      title: "Design ER diagram",
      type: "HOMEWORK",
      courseId,
      dueDate: "2033-10-01T23:59:00.000Z",
    });
    const taskId = task.body.data.id;

    const subtask = await authRequestJson("post", `${BASE}/tasks/${taskId}/subtasks`, token, {
      title: "List entities",
    });
    await authRequestJson("patch", `${BASE}/tasks/${taskId}/subtasks/${subtask.body.data.id}`, token, {
      status: "COMPLETED",
    });

    const tag = await authRequestJson("post", `${BASE}/tasks/${taskId}/tags`, token, {
      name: "midterm",
      color: "orange",
    });
    expect(tag.body.data.name).toBe("midterm");

    // 3. Note + resource linked to the course
    const note = await authRequestJson("post", `${BASE}/notes`, token, {
      title: "ER design notes",
      content: "# Entities\nUsers, Orders",
      courseId,
    });
    const resource = await authRequestJson("post", `${BASE}/resources`, token, {
      title: "ER guide",
      url: "https://example.org/er.pdf",
      storageType: "URL",
      resourceType: "PDF",
      courseId,
    });

    // 4. Calendar event + study session
    const event = await authRequestJson("post", `${BASE}/events`, token, {
      title: "DB midterm",
      type: "EXAM",
      courseId,
      startAt: "2033-11-15T09:00:00.000Z",
      endAt: "2033-11-15T11:00:00.000Z",
    });

    const session = await authRequestJson("post", `${BASE}/study-sessions`, token, {
      courseId,
      taskId,
      topic: "Normalization",
      startedAt: "2033-10-05T18:00:00.000Z",
      durationMinutes: 75,
      focusRating: 4,
    });
    expect(session.body.data.durationMinutes).toBe(75);

    // 5. Goal + milestone
    const goal = await authRequestJson("post", `${BASE}/goals`, token, {
      title: "Ace Databases",
      deadline: "2033-11-20T00:00:00.000Z",
    });
    const milestone = await authRequestJson("post", `${BASE}/goals/${goal.body.data.id}/milestones`, token, {
      title: "Learn normalization",
    });
    await authRequestJson("patch", `${BASE}/goals/${goal.body.data.id}/milestones/${milestone.body.data.id}`, token, {
      status: "COMPLETED",
    });

    // 6. Grade
    const grade = await authRequestJson("post", `${BASE}/grades`, token, {
      title: "Midterm",
      courseId,
      score: 42,
      maxScore: 50,
      weight: 0.4,
      type: "EXAM",
    });

    // 7. Settings + notification flow
    await authRequestJson("patch", `${BASE}/settings`, token, {
      settings: { study_reminders: "true" },
    });
    const settings = await authRequestJson("get", `${BASE}/settings`, token);
    expect(settings.body.data.study_reminders).toBe("true");

    const notifications = await authRequestJson("get", `${BASE}/notifications`, token);
    expect(notifications.body.data.unreadCount).toBe(0);

    // 8. AI study-plan scaffold (store-only; no generation in tests)
    const plan = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
      title: "Midterm prep",
      courseId,
      examDate: "2033-11-15T00:00:00.000Z",
      entries: [
        { dayNumber: 1, title: "SQL review", durationMinutes: 60 },
        { dayNumber: 2, title: "Past papers", durationMinutes: 90 },
      ],
    });
    const conversation = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
      title: "DB tutor",
    });
    const message = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversation.body.data.id}/messages`,
      token,
      { content: "Remind me about the midterm", generateReply: false },
    );
    expect(message.body.data.message.role).toBe("USER");

    // 9. Dashboard aggregates everything
    const dashboard = await authRequestJson("get", `${BASE}/dashboard`, token);
    expect(dashboard.body.data.courses.total).toBe(1);
    expect(dashboard.body.data.tasks.total).toBe(1);
    expect(dashboard.body.data.activeGoals.length).toBe(1);
    expect(dashboard.body.data.recentNotes[0].id).toBe(note.body.data.id);
    expect(dashboard.body.data.recentGrades[0].id).toBe(grade.body.data.id);
    expect(dashboard.body.data.events.today).toBeInstanceOf(Array);
    expect(dashboard.body.data.events.upcoming).toBeInstanceOf(Array);
    expect(dashboard.body.data.studySessions.todayCount).toBe(0);
    expect(dashboard.body.data.studySessions.recent.length).toBe(1);

    // 10. Sanity: everything we created is reachable
    await authRequestJson("get", `${BASE}/notes/${note.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/resources/${resource.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/events/${event.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/study-sessions/${session.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/goals/${goal.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/grades/${grade.body.data.id}`, token);
    await authRequestJson("get", `${BASE}/tasks/${taskId}`, token);
    await authRequestJson("get", `${BASE}/ai/study-plans/${plan.body.data.id}`, token);
  });
});