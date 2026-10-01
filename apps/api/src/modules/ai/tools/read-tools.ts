import { z } from "zod";

import { tasksService } from "@/modules/tasks/service";
import { subtasksService } from "@/modules/subtasks/service";
import { taskTagsService } from "@/modules/task-tags/service";
import { coursesService } from "@/modules/courses/service";
import { eventsService } from "@/modules/events/service";
import { studySessionsService } from "@/modules/study-sessions/service";
import { goalsService } from "@/modules/goals/service";
import { gradesService } from "@/modules/grades/service";
import { notesService } from "@/modules/notes/service";
import { resourcesService } from "@/modules/resources/service";
import { notificationsService } from "@/modules/notifications/service";
import { academicYearsService } from "@/modules/academics/academic-years/service";
import { semestersService } from "@/modules/academics/semesters/service";
import { dashboardService } from "@/modules/dashboard/service";

import { requireEntityIdFromArgs } from "./resolver";
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
    "List the student's goals with progress, deadline and every milestone (title, status). Use for goal questions. For one goal's milestones in detail, call get_goal_milestones.",
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
  description:
    "List the student's notes (title, course, last updated) and optionally search inside their content. Bodies are excerpted here — use get_note for one note in full or search_notes to find passages.",
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

// ── Notes: one note in full, and search across note bodies ──────────────────

/** A single note body can be long; the read tool still has to fit in a prompt. */
const MAX_NOTE_CONTENT_CHARS = 12000;

const getNoteArgs = z.object({
  noteId: z.string().min(1).optional().describe("Id of the note, from get_notes or search_notes."),
  noteRef: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Note title, if the id is unknown. An ambiguous title returns candidates instead of guessing."),
});

export const getNoteTool: AiToolDefinition = {
  name: "get_note",
  description:
    "Read one note in full, including its body, when the student wants the actual content summarised, explained or quizzed on. Use after get_notes or search_notes have identified the note. Long bodies are truncated and say so.",
  kind: "READ",
  activityLabel: "Reading the note",
  parameters: getNoteArgs,
  async execute(args, ctx) {
    const input = getNoteArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "note", {
      id: input.noteId,
      ref: input.noteRef,
      entityName: "note",
    });

    const note = await notesService.getById(ctx.userId, target.id);
    const truncated = note.content.length > MAX_NOTE_CONTENT_CHARS;

    return ok(
      {
        id: note.id,
        title: note.title,
        courseId: note.courseId,
        course: note.course,
        content: truncated ? note.content.slice(0, MAX_NOTE_CONTENT_CHARS) : note.content,
        contentLength: note.content.length,
        truncated,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
      `Read "${note.title}" (${note.content.length} characters)`,
    );
  },
};

const searchNotesArgs = z.object({
  query: z.string().min(1).max(200).describe("Words to look for in note titles and bodies."),
  courseId: courseIdArg,
  limit: limitArg(10),
});

export const searchNotesTool: AiToolDefinition = {
  name: "search_notes",
  description:
    "Search inside the content of the student's notes (not just titles) and return the matching passages with surrounding context. Use when the student mentions a topic, definition or lecture rather than a note title.",
  kind: "READ",
  activityLabel: "Searching your notes",
  parameters: searchNotesArgs,
  async execute(args, ctx) {
    const input = searchNotesArgs.parse(args);
    const result = await notesService.list(ctx.userId, {
      search: input.query,
      limit: input.limit,
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });

    const terms = input.query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1);

    const items = result.items.slice(0, input.limit).map((note) => {
      const matches = countMatches(note.content, terms);
      return {
        id: note.id,
        title: note.title,
        courseId: note.courseId,
        course: note.course,
        matchCount: matches,
        excerpt: bestExcerpt(note.content, terms),
        updatedAt: note.updatedAt,
      };
    });

    return ok(
      {
        query: input.query,
        ...page(result, input.limit),
        items: items.sort((a, b) => b.matchCount - a.matchCount),
      },
      `${result.items.length} note(s) mention "${input.query}"`,
    );
  },
};

/** How many times any term appears, case-insensitively. */
function countMatches(content: string, terms: string[]): number {
  const haystack = content.toLowerCase();
  return terms.reduce((sum, term) => {
    let count = 0;
    let index = haystack.indexOf(term);
    while (index !== -1 && count < 50) {
      count += 1;
      index = haystack.indexOf(term, index + term.length);
    }
    return sum + count;
  }, 0);
}

/** A ~240 character window around the densest run of search terms. */
function bestExcerpt(content: string, terms: string[], window = 240): string {
  if (terms.length === 0) return content.slice(0, window);
  const haystack = content.toLowerCase();
  const first = terms.map((term) => haystack.indexOf(term)).filter((i) => i >= 0);
  if (first.length === 0) return content.slice(0, window);

  const start = Math.max(0, Math.min(...first) - Math.floor(window / 3));
  return `${start > 0 ? "…" : ""}${content.slice(start, start + window).trim()}${start + window < content.length ? "…" : ""}`;
}

// ── Task breakdown: subtasks and tags ───────────────────────────────────────

const getTaskSubtasksArgs = z.object({
  taskId: z.string().min(1).optional().describe("Id of the parent task, from get_tasks."),
  taskRef: z.string().min(1).max(200).optional().describe("Task title, if the id is unknown."),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

export const getTaskSubtasksTool: AiToolDefinition = {
  name: "get_task_subtasks",
  description:
    "List the subtasks of one task with their status and completion. Use when the student asks what a specific task is broken down into, or before adding or completing a subtask.",
  kind: "READ",
  activityLabel: "Checking the task's subtasks",
  parameters: getTaskSubtasksArgs,
  async execute(args, ctx) {
    const input = getTaskSubtasksArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.taskRef,
      entityName: "task",
    });

    const task = await tasksService.getById(ctx.userId, target.id);
    const subtasks = await subtasksService.list(ctx.userId, task.id, {
      ...(input.status ? { status: input.status } : {}),
    });

    const done = subtasks.filter((s) => s.status === "COMPLETED").length;

    return ok(
      {
        task: { id: task.id, title: task.title, status: task.status, course: task.course },
        items: subtasks,
        total: subtasks.length,
        completed: done,
        progressPercent: subtasks.length > 0 ? Math.round((done / subtasks.length) * 100) : 0,
      },
      `${subtasks.length} subtask(s) on "${task.title}", ${done} done`,
    );
  },
};

export const getTaskTagsTool: AiToolDefinition = {
  name: "get_task_tags",
  description: "List the tags on one task. Use before adding a tag, or to find tasks by label.",
  kind: "READ",
  activityLabel: "Checking the task's tags",
  parameters: z.object({
    taskId: z.string().min(1).optional().describe("Id of the task, from get_tasks."),
    taskRef: z.string().min(1).max(200).optional().describe("Task title, if the id is unknown."),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        taskId: z.string().min(1).optional().describe("Id of the task, from get_tasks."),
        taskRef: z.string().min(1).max(200).optional().describe("Task title, if the id is unknown."),
      })
      .parse(args);

    const target = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.taskRef,
      entityName: "task",
    });

    const task = await tasksService.getById(ctx.userId, target.id);
    const tags = await taskTagsService.list(ctx.userId, task.id);

    return ok(
      { task: { id: task.id, title: task.title }, items: tags, total: tags.length },
      `${tags.length} tag(s) on "${task.title}"`,
    );
  },
};

// ── Goals: milestones of one goal ───────────────────────────────────────────

export const getGoalMilestonesTool: AiToolDefinition = {
  name: "get_goal_milestones",
  description:
    "List the milestones of one goal with their status, in order. Use before adding, completing or reordering milestones.",
  kind: "READ",
  activityLabel: "Checking the goal's milestones",
  parameters: z.object({
    goalId: z.string().min(1).optional().describe("Id of the goal, from get_goals_and_milestones."),
    goalRef: z.string().min(1).max(200).optional().describe("Goal title, if the id is unknown."),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        goalId: z.string().min(1).optional().describe("Id of the goal, from get_goals_and_milestones."),
        goalRef: z.string().min(1).max(200).optional().describe("Goal title, if the id is unknown."),
      })
      .parse(args);

    const target = await requireEntityIdFromArgs(ctx.userId, "goal", {
      id: input.goalId,
      ref: input.goalRef,
      entityName: "goal",
    });

    const goal = await goalsService.getById(ctx.userId, target.id);
    const milestones = await goalsService.listMilestones(ctx.userId, goal.id);
    const done = milestones.filter((m) => m.status === "COMPLETED").length;

    return ok(
      {
        goal: { id: goal.id, title: goal.title, progress: goal.progress, status: goal.status },
        items: milestones,
        total: milestones.length,
        completed: done,
      },
      `${milestones.length} milestone(s) on "${goal.title}", ${done} done`,
    );
  },
};

// ── Academic structure ──────────────────────────────────────────────────────

export const getAcademicStructureTool: AiToolDefinition = {
  name: "get_academic_structure",
  description:
    "Return the student's academic years and semesters with their date ranges and statuses, and mark which one is current. Use for 'when is this semester', 'what year am I in' and to check a course's term before planning.",
  kind: "READ",
  activityLabel: "Checking your academic years and semesters",
  parameters: z.object({}),
  async execute(_args, ctx) {
    const [years, semesters] = await Promise.all([
      academicYearsService.listAcademicYears(ctx.userId),
      semestersService.listSemesters(ctx.userId),
    ]);

    const now = new Date();
    const isCurrent = (start: string, end: string) => {
      const from = new Date(`${start}T00:00:00`).getTime();
      const to = new Date(`${end}T23:59:59`).getTime();
      return now.getTime() >= from && now.getTime() <= to;
    };

    return ok(
      {
        academicYears: years.map((year) => ({
          ...year,
          isCurrent: isCurrent(year.startDate, year.endDate),
        })),
        semesters: semesters.map((semester) => ({
          ...semester,
          isCurrent: isCurrent(semester.startDate, semester.endDate),
          academicYearName: years.find((y) => y.id === semester.academicYearId)?.name ?? null,
        })),
        currentYearId: years.find((y) => isCurrent(y.startDate, y.endDate))?.id ?? null,
        currentSemesterId: semesters.find((s) => isCurrent(s.startDate, s.endDate))?.id ?? null,
      },
      `${years.length} academic year(s), ${semesters.length} semester(s)`,
    );
  },
};

// ── Notifications ───────────────────────────────────────────────────────────

export const getNotificationsTool: AiToolDefinition = {
  name: "get_notifications",
  description:
    "List the student's in-app reminders (assignment due, overdue, exam coming up, goal deadline) with the unread count. Use for 'what's nagging me' or to explain why StudentOS raised something.",
  kind: "READ",
  activityLabel: "Checking your notifications",
  parameters: z.object({
    unreadOnly: z.boolean().optional().default(false).describe("Only unread reminders."),
    type: z.enum(["ASSIGNMENT_DUE", "OVERDUE_TASK", "EXAM_REMINDER", "GOAL_REMINDER"]).optional(),
    limit: limitArg(20),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        unreadOnly: z.boolean().optional().default(false),
        type: z.enum(["ASSIGNMENT_DUE", "OVERDUE_TASK", "EXAM_REMINDER", "GOAL_REMINDER"]).optional(),
        limit: limitArg(20),
      })
      .parse(args);

    const result = await notificationsService.list(ctx.userId, {
      limit: input.limit,
      unread: input.unreadOnly,
      ...(input.type ? { type: input.type } : {}),
    });

    return ok(
      {
        ...page(result, input.limit),
        unreadCount: result.unreadCount,
        items: result.items.slice(0, input.limit).map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          status: n.status,
          relatedType: n.relatedType,
          relatedId: n.relatedId,
          createdAt: n.createdAt,
        })),
      },
      `${result.unreadCount} unread of ${result.items.length} reminder(s)`,
    );
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
  getGoalMilestonesTool,
  getGradesTool,
  getNotesTool,
  getNoteTool,
  searchNotesTool,
  getTaskSubtasksTool,
  getTaskTagsTool,
  getResourcesTool,
  getAcademicStructureTool,
  getNotificationsTool,
  getAcademicDashboardTool,
];
