import { z } from "zod";

import { tasksService } from "@/modules/tasks/service";
import { coursesService } from "@/modules/courses/service";
import { eventsService } from "@/modules/events/service";
import { studySessionsService } from "@/modules/study-sessions/service";
import { goalsService } from "@/modules/goals/service";
import { gradesService } from "@/modules/grades/service";
import { notesService } from "@/modules/notes/service";
import { resourcesService } from "@/modules/resources/service";
import { dashboardService } from "@/modules/dashboard/service";

import type { AiToolDefinition } from "./types";
import { daysUntil, isoDaysFromNow, ok } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// READ tools
// ─────────────────────────────────────────────────────────────────────────────
//
// Every one of these delegates to the matching module service, which is
// already scoped by `userId` — that is the single place ownership is enforced,
// so a read tool cannot leak another student's rows even by accident.
//
// Results are bounded twice: by the service's own `take`, and by a `limit`
// argument capped at 50. Nothing here returns a full table.

/** Shared limit for list-shaped reads. Hard ceiling keeps prompts small. */
const limitArg = (def: number, max = 50) =>
  z.number().int().min(1).max(max).optional().default(def).describe(`Maximum records to return (default ${def}, max ${max}).`);

const courseIdArg = z.string().min(1).optional().describe("Restrict to one course id (from get_courses).");

/** Trim a paginated service result down to what the model should see. */
function page<T extends { id: string }>(result: { items: T[]; hasMore: boolean }, limit: number) {
  return {
    items: result.items.slice(0, limit),
    returned: Math.min(result.items.length, limit),
    hasMore: result.hasMore,
  };
}

// ── Courses ────────────────────────────────────────────────────────────────

const getCoursesArgs = z.object({
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]).optional(),
  search: z.string().max(100).optional(),
  limit: limitArg(20),
});

export const getCoursesTool: AiToolDefinition = {
  name: "get_courses",
  description:
    "List the student's courses with code, credits, status and semester. Use this before any course-specific question or action so you use the real course id.",
  kind: "READ",
  activityLabel: "Checking your courses",
  parameters: getCoursesArgs,
  async execute(args, ctx) {
    const input = getCoursesArgs.parse(args);
    const result = await coursesService.list(ctx.userId, { limit: input.limit }, {
      status: input.status,
      search: input.search,
    });
    return ok(page(result, input.limit), `${result.items.length} course(s)`);
  },
};

export const getActiveCoursesTool: AiToolDefinition = {
  name: "get_active_courses",
  description:
    "List only the courses currently in progress (status ACTIVE), with semester and academic-year context. This is the right tool for 'what am I taking'.",
  kind: "READ",
  activityLabel: "Checking your active courses",
  parameters: z.object({ limit: limitArg(30) }),
  async execute(args, ctx) {
    const input = z.object({ limit: limitArg(30) }).parse(args);
    const result = await coursesService.list(ctx.userId, { limit: input.limit }, { status: "ACTIVE" });
    return ok(page(result, input.limit), `${result.items.length} active course(s)`);
  },
};

// ── Tasks ───────────────────────────────────────────────────────────────────

const taskStatus = z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const taskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const taskType = z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]);

const getTasksArgs = z.object({
  status: taskStatus.optional().describe("Filter by status. Use TODO or IN_PROGRESS for open work."),
  priority: taskPriority.optional(),
  type: taskType.optional(),
  courseId: courseIdArg,
  dueBefore: z.string().optional().describe("ISO datetime upper bound on the due date."),
  dueAfter: z.string().optional().describe("ISO datetime lower bound on the due date."),
  search: z.string().max(200).optional().describe("Match against the task title or description."),
  limit: limitArg(20),
});

export const getTasksTool: AiToolDefinition = {
  name: "get_tasks",
  description:
    "List tasks with status, priority, due date and course. Filter for open work (status TODO / IN_PROGRESS) when the student asks what is outstanding.",
  kind: "READ",
  activityLabel: "Checking your tasks",
  parameters: getTasksArgs,
  async execute(args, ctx) {
    const input = getTasksArgs.parse(args);
    const result = await tasksService.list(ctx.userId, {
      status: input.status,
      priority: input.priority,
      type: input.type,
      courseId: input.courseId,
      dueBefore: input.dueBefore,
      dueAfter: input.dueAfter,
      search: input.search,
      limit: input.limit,
    });
    return ok(page(result, input.limit), `${result.items.length} task(s)`);
  },
};

const getOpenTasksArgs = z.object({
  withinDays: z
    .number()
    .int()
    .min(0)
    .max(60)
    .optional()
    .default(14)
    .describe("How far ahead to look, in days. Defaults to 14."),
  courseId: courseIdArg,
  limit: limitArg(20),
});

export const getUpcomingTasksTool: AiToolDefinition = {
  name: "get_upcoming_tasks",
  description:
    "List open tasks (TODO or IN_PROGRESS) due within a number of days, soonest first, with the number of days remaining. Use for 'what is due soon'.",
  kind: "READ",
  activityLabel: "Checking your upcoming tasks",
  parameters: getOpenTasksArgs,
  async execute(args, ctx) {
    const input = getOpenTasksArgs.parse(args);
    const result = await tasksService.list(ctx.userId, {
      dueAfter: new Date().toISOString(),
      dueBefore: isoDaysFromNow(input.withinDays),
      limit: input.limit,
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });

    const now = new Date();
    const open = result.items.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    return ok(
      {
        windowDays: input.withinDays,
        ...page({ items: open, hasMore: result.hasMore }, input.limit),
        items: open.slice(0, input.limit).map((t) => ({ ...t, daysRemaining: daysUntil(t.dueDate, now) })),
      },
      `${open.length} task(s) due within ${input.withinDays} day(s)`,
    );
  },
};

const getOverdueTasksArgs = z.object({
  includeToday: z.boolean().optional().default(true).describe("Include tasks due earlier today."),
  courseId: courseIdArg,
  limit: limitArg(20),
});

export const getOverdueTasksTool: AiToolDefinition = {
  name: "get_overdue_tasks",
  description:
    "List open tasks whose due date has already passed, with how many days late each one is. Use whenever the student asks what is late or behind.",
  kind: "READ",
  activityLabel: "Checking your overdue tasks",
  parameters: getOverdueTasksArgs,
  async execute(args, ctx) {
    const input = getOverdueTasksArgs.parse(args);
    const cutoff = new Date();
    if (input.includeToday) cutoff.setHours(0, 0, 0, 0);

    const result = await tasksService.list(ctx.userId, {
      dueBefore: cutoff.toISOString(),
      limit: input.limit,
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });

    const now = new Date();
    const open = result.items.filter(
      (t) => (t.status === "TODO" || t.status === "IN_PROGRESS") && t.dueDate !== null,
    );

    return ok(
      {
        ...page({ items: open, hasMore: result.hasMore }, input.limit),
        items: open.slice(0, input.limit).map((t) => ({ ...t, daysOverdue: daysUntil(t.dueDate, now) })),
      },
      `${open.length} overdue task(s)`,
    );
  },
};

// ── Calendar / exams ────────────────────────────────────────────────────────

const getCalendarEventsArgs = z.object({
  from: z.string().optional().describe("ISO datetime lower bound. Defaults to now."),
  to: z.string().optional().describe("ISO datetime upper bound."),
  type: z.enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"]).optional(),
  courseId: courseIdArg,
  limit: limitArg(20),
});

export const getCalendarEventsTool: AiToolDefinition = {
  name: "get_calendar_events",
  description:
    "List calendar entries (classes, exams, assignments, meetings) in a date range, soonest first. Use for anything about the student's schedule.",
  kind: "READ",
  activityLabel: "Checking your calendar",
  parameters: getCalendarEventsArgs,
  async execute(args, ctx) {
    const input = getCalendarEventsArgs.parse(args);
    const result = await eventsService.list(ctx.userId, {
      startFrom: input.from,
      startTo: input.to,
      type: input.type,
      courseId: input.courseId,
      limit: input.limit,
    });
    const now = new Date();
    return ok(
      {
        ...page(result, input.limit),
        items: result.items.slice(0, input.limit).map((e) => ({ ...e, daysUntil: daysUntil(e.startAt, now) })),
      },
      `${result.items.length} event(s)`,
    );
  },
};

const getUpcomingExamsArgs = z.object({
  withinDays: z
    .number()
    .int()
    .min(1)
    .max(180)
    .optional()
    .default(90)
    .describe("How far ahead to look for exams, in days. Defaults to 90."),
  courseId: courseIdArg,
  limit: limitArg(10),
});

export const getUpcomingExamsTool: AiToolDefinition = {
  name: "get_upcoming_exams",
  description:
    "List upcoming exams (calendar entries of type EXAM) with the date, location, course and days remaining. Use this before planning any revision or study plan.",
  kind: "READ",
  activityLabel: "Checking your upcoming exams",
  parameters: getUpcomingExamsArgs,
  async execute(args, ctx) {
    const input = getUpcomingExamsArgs.parse(args);
    const now = new Date();
    const result = await eventsService.list(ctx.userId, {
      type: "EXAM",
      startFrom: now.toISOString(),
      startTo: isoDaysFromNow(input.withinDays),
      limit: input.limit,
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });
    return ok(
      {
        windowDays: input.withinDays,
        ...page(result, input.limit),
        items: result.items.slice(0, input.limit).map((e) => ({ ...e, daysUntil: daysUntil(e.startAt, now) })),
      },
      `${result.items.length} upcoming exam(s)`,
    );
  },
};

// ── Study sessions ──────────────────────────────────────────────────────────

const getStudySessionsArgs = z.object({
  courseId: courseIdArg,
  range: z.enum(["today", "week", "month"]).optional().describe("Convenience window: today, last 7 days, or this month."),
  from: z.string().optional().describe("ISO datetime lower bound."),
  to: z.string().optional().describe("ISO datetime upper bound."),
  limit: limitArg(20),
});

export const getStudySessionsTool: AiToolDefinition = {
  name: "get_study_sessions",
  description:
    "List logged study sessions (topic, course, start, duration, focus rating) with a total-minutes summary for the filtered set.",
  kind: "READ",
  activityLabel: "Checking your study sessions",
  parameters: getStudySessionsArgs,
  async execute(args, ctx) {
    const input = getStudySessionsArgs.parse(args);
    const result = await studySessionsService.list(ctx.userId, {
      courseId: input.courseId,
      range: input.range,
      from: input.from,
      to: input.to,
      limit: input.limit,
    });
    return ok(
      { ...page(result, input.limit), summary: result.summary },
      `${result.summary.count} session(s), ${result.summary.totalMinutes} min total`,
    );
  },
};

const getStudyHistoryArgs = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(180)
    .optional()
    .default(30)
    .describe("How far back to look, in days. Defaults to 30."),
  courseId: courseIdArg,
  limit: limitArg(50, 100),
});

export const getStudyHistoryTool: AiToolDefinition = {
  name: "get_study_history",
  description:
    "Summarise recent study history: every session in the window, minutes per day, total minutes and the average session length. Use for consistency questions.",
  kind: "READ",
  activityLabel: "Reviewing your study history",
  parameters: getStudyHistoryArgs,
  async execute(args, ctx) {
    const input = getStudyHistoryArgs.parse(args);
    const from = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

    const result = await studySessionsService.list(ctx.userId, {
      from: from.toISOString(),
      limit: input.limit,
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });

    const perDay = new Map<string, number>();
    for (const session of result.items) {
      const day = session.startedAt.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + (session.durationMinutes ?? 0));
    }

    const durations = result.items.map((s) => s.durationMinutes ?? 0);
    const totalMinutes = durations.reduce((a, b) => a + b, 0);

    return ok(
      {
        windowDays: input.days,
        sessions: page(result, input.limit).items,
        totalMinutes,
        sessionCount: result.items.length,
        averageSessionMinutes: durations.length > 0 ? Math.round(totalMinutes / durations.length) : 0,
        minutesPerDay: [...perDay.entries()].map(([day, minutes]) => ({ day, minutes })).sort((a, b) => a.day.localeCompare(b.day)),
        activeDays: perDay.size,
      },
      `${result.items.length} session(s) over ${input.days} day(s), ${totalMinutes} min total`,
    );
  },
};

// ── Goals ───────────────────────────────────────────────────────────────────

export const getGoalsTool: AiToolDefinition = {
  name: "get_goals_and_milestones",
  description:
    "List the student's goals with progress, deadline and every milestone (title, status). Use for goal and milestone questions.",
  kind: "READ",
  activityLabel: "Checking your goals",
  parameters: z.object({
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
    limit: limitArg(20),
  }),
  async execute(args, ctx) {
    const input = z.object({ status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(), limit: limitArg(20) }).parse(args);
    const result = await goalsService.list(ctx.userId, {
      status: input.status,
      limit: input.limit,
    });
    const now = new Date();
    return ok(
      {
        ...page(result, input.limit),
        items: result.items.slice(0, input.limit).map((g) => ({ ...g, daysRemaining: daysUntil(g.deadline, now) })),
      },
      `${result.items.length} goal(s)`,
    );
  },
};

// ── Grades ──────────────────────────────────────────────────────────────────

export const getGradesTool: AiToolDefinition = {
  name: "get_grades",
  description:
    "List recorded grades with score, maxScore, weight, type and course. Percentages are computed from the recorded values only.",
  kind: "READ",
  activityLabel: "Checking your grades",
  parameters: z.object({
    courseId: courseIdArg,
    type: z.enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"]).optional(),
    limit: limitArg(30),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        courseId: courseIdArg,
        type: z.enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"]).optional(),
        limit: limitArg(30),
      })
      .parse(args);
    const result = await gradesService.list(ctx.userId, {
      courseId: input.courseId,
      type: input.type,
      limit: input.limit,
    });
    return ok(
      {
        ...page(result, input.limit),
        items: result.items.slice(0, input.limit).map((g) => ({
          ...g,
          percent: g.score !== null && g.maxScore ? Math.round((g.score / g.maxScore) * 100) : null,
        })),
      },
      `${result.items.length} grade(s)`,
    );
  },
};

// ── Notes ───────────────────────────────────────────────────────────────────

export const getNotesTool: AiToolDefinition = {
  name: "get_notes",
  description: "List the student's notes (title, course, last updated) and optionally search inside their content.",
  kind: "READ",
  activityLabel: "Checking your notes",
  parameters: z.object({
    courseId: courseIdArg,
    search: z.string().max(200).optional(),
    limit: limitArg(20),
  }),
  async execute(args, ctx) {
    const input = z.object({ courseId: courseIdArg, search: z.string().max(200).optional(), limit: limitArg(20) }).parse(args);
    const result = await notesService.list(ctx.userId, {
      courseId: input.courseId,
      search: input.search,
      limit: input.limit,
    });
    // Note bodies can be long; the model only needs the titles to plan with.
    return ok(
      {
        ...page(result, input.limit),
        items: result.items.slice(0, input.limit).map((n) => ({
          id: n.id,
          title: n.title,
          courseId: n.courseId,
          course: n.course,
          excerpt: n.content.slice(0, 240),
          contentLength: n.content.length,
          updatedAt: n.updatedAt,
        })),
      },
      `${result.items.length} note(s)`,
    );
  },
};

// ── Resources ───────────────────────────────────────────────────────────────

export const getResourcesTool: AiToolDefinition = {
  name: "get_resources",
  description: "List the student's learning resources (title, type, course, link) for a course or a search term.",
  kind: "READ",
  activityLabel: "Checking your resources",
  parameters: z.object({
    courseId: courseIdArg,
    resourceType: z.enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"]).optional(),
    search: z.string().max(200).optional(),
    limit: limitArg(20),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        courseId: courseIdArg,
        resourceType: z.enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"]).optional(),
        search: z.string().max(200).optional(),
        limit: limitArg(20),
      })
      .parse(args);
    const result = await resourcesService.list(ctx.userId, {
      courseId: input.courseId,
      resourceType: input.resourceType,
      search: input.search,
      limit: input.limit,
    });
    return ok(page(result, input.limit), `${result.items.length} resource(s)`);
  },
};

// ── Dashboard ───────────────────────────────────────────────────────────────

export const getAcademicDashboardTool: AiToolDefinition = {
  name: "get_academic_dashboard",
  description:
    "Return the academic dashboard: task counts by status/priority, overdue and due-today totals, upcoming exams with a countdown, study minutes today and this week, active goals and recent grades. The fastest way to answer 'how am I doing'.",
  kind: "READ",
  activityLabel: "Loading your academic dashboard",
  parameters: z.object({}),
  async execute(_args, ctx) {
    const data = await dashboardService.getDashboard(ctx.userId);
    return ok(data, "Academic dashboard loaded");
  },
};

export const readTools: AiToolDefinition[] = [
  getCoursesTool,
  getActiveCoursesTool,
  getTasksTool,
  getUpcomingTasksTool,
  getOverdueTasksTool,
  getCalendarEventsTool,
  getUpcomingExamsTool,
  getStudySessionsTool,
  getStudyHistoryTool,
  getGoalsTool,
  getGradesTool,
  getNotesTool,
  getResourcesTool,
  getAcademicDashboardTool,
];
