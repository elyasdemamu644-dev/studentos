import { z } from "zod";

import { tasksService } from "@/modules/tasks/service";
import { studySessionsService } from "@/modules/study-sessions/service";
import { goalsService } from "@/modules/goals/service";
import { notesService } from "@/modules/notes/service";
import { resourcesService } from "@/modules/resources/service";

import type { AiToolDefinition } from "./types";
import { ok, toDate, toIsoTimestamp } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// WRITE tools (action tools)
// ─────────────────────────────────────────────────────────────────────────────
//
// These change StudentOS data, so two constraints apply:
//
//  1. They run through the existing module services — never Prisma — so the
//     normal ownership checks, validation and business rules still apply. A
//     courseId from another student resolves to 404 inside the service, exactly
//     as it would over HTTP.
//  2. They are blocked by the registry unless the student has confirmed this
//     exact call. The confirmation gate lives in registry.ts, not here, so a
//     new write tool cannot forget it.
//
// There is deliberately no delete, no bulk operation and no free-form update
// tool: every action names one record and one bounded change.
//
// Arguments arrive as ISO strings because that is what a model can produce
// reliably; each handler converts to the `Date`/datetime string its service
// schema expects.

const courseIdArg = z.string().min(1).optional().describe("Course id, from get_courses.");

/** A date or date-time string. Bare `YYYY-MM-DD` is accepted as 09:00 local. */
const dateArg = (description: string) =>
  z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "must be a valid ISO-8601 date or date-time")
    .describe(description);

const isoDate = dateArg("ISO-8601 date or date-time. A date alone (2026-01-15) becomes 09:00 local time.").optional();

// ── Tasks ───────────────────────────────────────────────────────────────────

const createTaskArgs = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: isoDate,
  estimatedMinutes: z.number().int().min(0).max(10080).optional(),
  courseId: courseIdArg,
});

export const createTaskTool: AiToolDefinition = {
  name: "create_task",
  description: "Create one task. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a task",
  parameters: createTaskArgs,
  async execute(args, ctx) {
    const input = createTaskArgs.parse(args);
    const task = await tasksService.create(ctx.userId, { ...input, dueDate: toIsoTimestamp(input.dueDate) });
    return ok({ id: task.id, title: task.title, dueDate: task.dueDate, courseId: task.courseId, status: task.status }, `Created task "${task.title}"`);
  },
};

const updateTaskArgs = z.object({
  taskId: z.string().min(1).describe("Id of the task to update, from get_tasks."),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  type: z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  dueDate: z.union([z.string(), z.null()]).optional().describe("New ISO-8601 date, or null to clear it."),
  estimatedMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  courseId: z.string().min(1).nullable().optional(),
});

export const updateTaskTool: AiToolDefinition = {
  name: "update_task",
  description: "Change fields on one existing task. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a task",
  parameters: updateTaskArgs,
  async execute(args, ctx) {
    const { taskId, ...fields } = updateTaskArgs.parse(args);
    const task = await tasksService.update(ctx.userId, taskId, { ...fields, dueDate: toIsoTimestamp(fields.dueDate) });
    return ok({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueDate: task.dueDate }, `Updated task "${task.title}"`);
  },
};

const completeTaskArgs = z.object({
  taskId: z.string().min(1).describe("Id of the task to complete, from get_tasks."),
});

export const completeTaskTool: AiToolDefinition = {
  name: "complete_task",
  description: "Mark one task complete and stamp completedAt. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Completing a task",
  parameters: completeTaskArgs,
  async execute(args, ctx) {
    const { taskId } = completeTaskArgs.parse(args);
    const task = await tasksService.complete(ctx.userId, taskId);
    return ok({ id: task.id, title: task.title, status: task.status, completedAt: task.completedAt }, `Completed task "${task.title}"`);
  },
};

// ── Study sessions ──────────────────────────────────────────────────────────

const createStudySessionArgs = z.object({
  courseId: courseIdArg,
  taskId: z.string().min(1).optional().describe("Task this session was for."),
  topic: z.string().min(1).max(300).optional(),
  startedAt: dateArg("ISO-8601 start time. Use a past time when logging a session that already happened."),
  endedAt: dateArg("ISO-8601 end time. Omit for an open session.").optional(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  focusRating: z.number().int().min(1).max(5).optional(),
});

export const createStudySessionTool: AiToolDefinition = {
  name: "create_study_session",
  description: "Log one study session. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Adding a study session",
  parameters: createStudySessionArgs,
  async execute(args, ctx) {
    const input = createStudySessionArgs.parse(args);
    const session = await studySessionsService.create(ctx.userId, {
      ...input,
      startedAt: toDate(input.startedAt) as Date,
      endedAt: toDate(input.endedAt) ?? null,
    });
    return ok(
      { id: session.id, topic: session.topic, startedAt: session.startedAt, durationMinutes: session.durationMinutes },
      `Logged study session "${session.topic ?? "untitled"}"`,
    );
  },
};

const updateStudySessionArgs = z.object({
  sessionId: z.string().min(1).describe("Id of the study session to update, from get_study_sessions."),
  courseId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  topic: z.string().min(1).max(300).nullable().optional(),
  startedAt: dateArg("New ISO-8601 start time.").optional(),
  endedAt: z.union([z.string(), z.null()]).optional().describe("New ISO-8601 end time, or null to clear it."),
  durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  focusRating: z.number().int().min(1).max(5).nullable().optional(),
});

export const updateStudySessionTool: AiToolDefinition = {
  name: "update_study_session",
  description: "Change fields on one logged study session. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a study session",
  parameters: updateStudySessionArgs,
  async execute(args, ctx) {
    const { sessionId, ...fields } = updateStudySessionArgs.parse(args);
    const session = await studySessionsService.update(ctx.userId, sessionId, {
      courseId: fields.courseId,
      taskId: fields.taskId,
      topic: fields.topic,
      durationMinutes: fields.durationMinutes,
      focusRating: fields.focusRating,
      ...("startedAt" in fields ? { startedAt: toDate(fields.startedAt) as Date } : {}),
      ...("endedAt" in fields ? { endedAt: toDate(fields.endedAt) ?? null } : {}),
    });
    return ok(
      { id: session.id, topic: session.topic, startedAt: session.startedAt, durationMinutes: session.durationMinutes },
      `Updated study session "${session.topic ?? "untitled"}"`,
    );
  },
};

// ── Goals ───────────────────────────────────────────────────────────────────

const createGoalArgs = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  deadline: isoDate,
});

export const createGoalTool: AiToolDefinition = {
  name: "create_goal",
  description: "Create one goal. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a goal",
  parameters: createGoalArgs,
  async execute(args, ctx) {
    const input = createGoalArgs.parse(args);
    const goal = await goalsService.create(ctx.userId, { ...input, deadline: toDate(input.deadline) ?? null });
    return ok({ id: goal.id, title: goal.title, progress: goal.progress, deadline: goal.deadline }, `Created goal "${goal.title}"`);
  },
};

const updateGoalProgressArgs = z.object({
  goalId: z.string().min(1).describe("Id of the goal, from get_goals_and_milestones."),
  progress: z.number().int().min(0).max(100).optional().describe("New progress percentage, 0-100."),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  title: z.string().min(1).max(200).optional(),
  deadline: z.union([z.string(), z.null()]).optional().describe("New ISO-8601 deadline, or null to clear it."),
});

export const updateGoalProgressTool: AiToolDefinition = {
  name: "update_goal_progress",
  description: "Update a goal's progress, status, title or deadline. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a goal",
  parameters: updateGoalProgressArgs,
  async execute(args, ctx) {
    const { goalId, ...fields } = updateGoalProgressArgs.parse(args);
    const goal = await goalsService.update(ctx.userId, goalId, { ...fields, deadline: toDate(fields.deadline) ?? null });
    return ok({ id: goal.id, title: goal.title, progress: goal.progress, status: goal.status }, `Updated goal "${goal.title}" (${goal.progress}%)`);
  },
};

// ── Notes ───────────────────────────────────────────────────────────────────

const createNoteArgs = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  courseId: courseIdArg,
});

export const createNoteTool: AiToolDefinition = {
  name: "create_note",
  description: "Create one note. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a note",
  parameters: createNoteArgs,
  async execute(args, ctx) {
    const input = createNoteArgs.parse(args);
    const note = await notesService.create(ctx.userId, input);
    return ok({ id: note.id, title: note.title, courseId: note.courseId }, `Created note "${note.title}"`);
  },
};

// ── Resources ───────────────────────────────────────────────────────────────

const createResourceArgs = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().describe("Link to the resource. File uploads are not supported yet."),
  description: z.string().max(2000).optional(),
  resourceType: z.enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"]).optional(),
  courseId: courseIdArg,
});

export const createResourceTool: AiToolDefinition = {
  name: "create_resource",
  description: "Save one link resource. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Saving a resource",
  parameters: createResourceArgs,
  async execute(args, ctx) {
    const input = createResourceArgs.parse(args);
    const resource = await resourcesService.create(ctx.userId, {
      ...input,
      storageType: "URL",
    });
    return ok({ id: resource.id, title: resource.title, url: resource.url, courseId: resource.courseId }, `Saved resource "${resource.title}"`);
  },
};

export const actionTools: AiToolDefinition[] = [
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  createStudySessionTool,
  updateStudySessionTool,
  createGoalTool,
  updateGoalProgressTool,
  createNoteTool,
  createResourceTool,
];
