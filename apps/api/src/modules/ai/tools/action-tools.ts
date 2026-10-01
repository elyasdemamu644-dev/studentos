import { z } from "zod";

import { tasksService } from "@/modules/tasks/service";
import { subtasksService } from "@/modules/subtasks/service";
import { taskTagsService } from "@/modules/task-tags/service";
import { studySessionsService } from "@/modules/study-sessions/service";
import { goalsService } from "@/modules/goals/service";
import { notesService } from "@/modules/notes/service";
import { resourcesService } from "@/modules/resources/service";
import { eventsService } from "@/modules/events/service";
import { gradesService } from "@/modules/grades/service";
import { coursesService } from "@/modules/courses/service";

import { requireEntityIdFromArgs } from "./resolver";
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

/** A date or date-time string. Bare `YYYY-MM-DD` is accepted as 09:00 local. */
const dateArg = (description: string) =>
  z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "must be a valid ISO-8601 date or date-time")
    .describe(description);

const isoDate = dateArg("ISO-8601 date or date-time. A date alone (2026-01-15) becomes 09:00 local time.").optional();

// ── Natural references ──────────────────────────────────────────────────────
//
// A student says "the Database exam", not an id. Every tool that touches an
// existing record therefore accepts either the id (preferred, from a read tool)
// or a human reference, which goes through the shared resolver. A reference that
// matches two records is refused as ambiguous and becomes a question — the tool
// never picks one for the student.

const idArg = (what: string, source: string) =>
  z.string().min(1).optional().describe(`Id of the ${what}, from ${source}.`);

const refArg = (what: string) =>
  z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      `Name, code or title of the ${what}, if the id is unknown. An ambiguous reference returns candidates instead of guessing.`,
    );

/** Course id or course name/code, for tools that attach a record to a course. */
const courseRefShape = {
  courseId: z.string().min(1).optional().describe("Course id, from get_courses."),
  course: refArg("course"),
};

/** Resolve a course reference to an id, or `undefined` when neither was given. */
async function resolveCourseId(
  userId: string,
  courseId: string | undefined,
  course: string | undefined,
): Promise<string | undefined> {
  if (courseId) return courseId;
  if (!course) return undefined;
  const resolved = await requireEntityIdFromArgs(userId, "course", { ref: course, entityName: "course" });
  return resolved.id;
}

// ── Proposal preparation ─────────────────────────────────────────────────────
//
// A WRITE tool cannot run on the turn that asks for it, so the arguments the
// student approves are resolved *here*, before the proposal is parked. Two
// things that matter follow from that:
//
//   * the confirmation card names the actual record ("DB301"), not the loose
//     phrase the student used, so what they approve is what will happen; and
//   * an ambiguous or missing reference is answered during the conversation,
//     instead of the student clicking Confirm and only then being told the
//     record was never found.
//
// Explicit ids still win: `prepare` only acts on a reference the model supplied.

/** One natural reference a write tool can accept, and where its id belongs. */
interface RefSpec {
  kind: "course" | "task" | "subtask" | "session" | "goal" | "milestone" | "note" | "resource" | "event" | "grade";
  /** Argument the reference arrives in, e.g. `task`. */
  ref: string;
  /** Argument that receives the resolved id, e.g. `taskId`. */
  id: string;
  /** Child records only: the parent's id argument, used to scope the lookup. */
  parentId?: string;
  /** Child records only: the parent's reference argument. */
  parentRef?: string;
}

/** `course`/`courseId` for every tool that can attach a record to a course. */
const COURSE_REF: RefSpec = { kind: "course", ref: "course", id: "courseId" };

/** The record each tool updates, named however the student named it. */
const TASK_REF: RefSpec = { kind: "task", ref: "task", id: "taskId" };
const SESSION_REF: RefSpec = { kind: "session", ref: "session", id: "sessionId" };
const GOAL_REF: RefSpec = { kind: "goal", ref: "goal", id: "goalId" };
const NOTE_REF: RefSpec = { kind: "note", ref: "note", id: "noteId" };
const RESOURCE_REF: RefSpec = { kind: "resource", ref: "resource", id: "resourceId" };
const EVENT_REF: RefSpec = { kind: "event", ref: "event", id: "eventId" };
const GRADE_REF: RefSpec = { kind: "grade", ref: "grade", id: "gradeId" };

/** `update_course` targets the course itself, so it has no separate ref field. */
const COURSE_TARGET_REF: RefSpec = { kind: "course", ref: "course", id: "courseId" };

/** Children are only ever resolvable inside their own parent. */
const SUBTASK_REF: RefSpec = {
  kind: "subtask",
  ref: "subtask",
  id: "subtaskId",
  parentId: "taskId",
  parentRef: "task",
};
const MILESTONE_REF: RefSpec = {
  kind: "milestone",
  ref: "milestone",
  id: "milestoneId",
  parentId: "goalId",
  parentRef: "goal",
};


/**
 * Build the `prepare` hook for a tool from its reference shape.
 *
 * Throws `EntityResolutionError` (via the resolver) when a reference is missing
 * or ambiguous, which the registry turns into a readable tool failure.
 */
function prepareWith(specs: RefSpec[]): NonNullable<AiToolDefinition["prepare"]> {
  return async (rawArgs, ctx) => {
    const args: Record<string, unknown> = { ...rawArgs };

    for (const spec of specs) {
      const ref = args[spec.ref];
      const hasRef = typeof ref === "string" && ref.trim().length > 0;

      // A child record can be named by reference only inside its parent.
      if (spec.parentId) {
        const parentRef = spec.parentRef ? args[spec.parentRef] : undefined;
        const parentId = await requireEntityIdFromArgs(ctx.userId, parentKindFor(spec.kind), {
          id: args[spec.parentId] as string | undefined,
          ref: typeof parentRef === "string" ? parentRef : undefined,
          entityName: parentKindFor(spec.kind),
        }).then((r) => r.id);
        args[spec.parentId] = parentId;

        if (hasRef) {
          args[spec.id] = (
            await requireEntityIdFromArgs(ctx.userId, spec.kind, {
              ref: ref as string,
              parentId,
              entityName: spec.kind,
            })
          ).id;
        }
        continue;
      }

      if (hasRef) {
        args[spec.id] = (
          await requireEntityIdFromArgs(ctx.userId, spec.kind, {
            ref: ref as string,
            entityName: spec.kind,
          })
        ).id;
      }
    }

    return args;
  };
}

/** A subtask hangs off a task; a milestone hangs off a goal. */
function parentKindFor(kind: RefSpec["kind"]): RefSpec["kind"] {
  if (kind === "subtask") return "task";
  if (kind === "milestone") return "goal";
  return kind;
}


// ── Tasks ───────────────────────────────────────────────────────────────────

const createTaskArgs = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: isoDate,
  estimatedMinutes: z.number().int().min(0).max(10080).optional(),
  ...courseRefShape,
});

export const createTaskTool: AiToolDefinition = {
  name: "create_task",
  description: "Create one task. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a task",
  parameters: createTaskArgs,
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createTaskArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const task = await tasksService.create(ctx.userId, {
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      estimatedMinutes: input.estimatedMinutes,
      courseId,
      dueDate: toIsoTimestamp(input.dueDate),
    });
    return ok({ id: task.id, title: task.title, dueDate: task.dueDate, courseId: task.courseId, status: task.status }, `Created task "${task.title}"`);
  },
};

const updateTaskArgs = z.object({
  taskId: idArg("task", "get_tasks"),
  task: refArg("task"),
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
  prepare: prepareWith([TASK_REF, COURSE_REF]),
  async execute(args, ctx) {
    const { taskId, task, ...fields } = updateTaskArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "task", { id: taskId, ref: task, entityName: "task" });
    const updated = await tasksService.update(ctx.userId, target.id, {
      title: fields.title,
      description: fields.description,
      type: fields.type,
      priority: fields.priority,
      status: fields.status,
      courseId: fields.courseId,
      estimatedMinutes: fields.estimatedMinutes,
      dueDate: toIsoTimestamp(fields.dueDate),
    });
    return ok({ id: updated.id, title: updated.title, status: updated.status, priority: updated.priority, dueDate: updated.dueDate }, `Updated task "${updated.title}"`);
  },
};

const completeTaskArgs = z.object({
  taskId: idArg("task", "get_tasks"),
  task: refArg("task"),
});

export const completeTaskTool: AiToolDefinition = {
  name: "complete_task",
  description: "Mark one task complete and stamp completedAt. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Completing a task",
  parameters: completeTaskArgs,
  prepare: prepareWith([TASK_REF]),
  async execute(args, ctx) {
    const input = completeTaskArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.task,
      entityName: "task",
    });
    const task = await tasksService.complete(ctx.userId, target.id);
    return ok({ id: task.id, title: task.title, status: task.status, completedAt: task.completedAt }, `Completed task "${task.title}"`);
  },
};

// ── Subtasks and tags ───────────────────────────────────────────────────────

const createSubtaskArgs = z.object({
  taskId: idArg("parent task", "get_tasks"),
  task: refArg("parent task"),
  title: z.string().min(1).max(200),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

export const createSubtaskTool: AiToolDefinition = {
  name: "create_subtask",
  description:
    "Break one task down by adding a subtask. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Adding a subtask",
  parameters: createSubtaskArgs,
  prepare: prepareWith([TASK_REF]),
  async execute(args, ctx) {
    const input = createSubtaskArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.task,
      entityName: "task",
    });
    const subtask = await subtasksService.create(ctx.userId, target.id, {
      title: input.title,
      ...(input.status ? { status: input.status } : {}),
    });
    return ok(
      { id: subtask.id, taskId: subtask.taskId, title: subtask.title, status: subtask.status, position: subtask.position },
      `Added subtask "${subtask.title}" to "${target.label}"`,
    );
  },
};

const updateSubtaskArgs = z.object({
  subtaskId: idArg("subtask", "get_task_subtasks"),
  subtask: refArg("subtask"),
  taskId: idArg("parent task", "get_task_subtasks"),
  task: refArg("parent task"),
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  position: z.number().int().min(0).optional(),
});

export const updateSubtaskTool: AiToolDefinition = {
  name: "update_subtask",
  description:
    "Change one subtask, including ticking it off. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a subtask",
  parameters: updateSubtaskArgs,
  prepare: prepareWith([SUBTASK_REF]),
  async execute(args, ctx) {
    const input = updateSubtaskArgs.parse(args);
    const parent = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.task,
      entityName: "task",
    });

    // Resolved inside the parent task only, so a subtask title that exists on a
    // different task can never be matched by accident.
    const subtaskTarget = await requireEntityIdFromArgs(ctx.userId, "subtask", {
      id: input.subtaskId,
      ref: input.subtask,
      parentId: parent.id,
      entityName: "subtask",
    });

    const subtask = await subtasksService.update(ctx.userId, parent.id, subtaskTarget.id, {
      title: input.title,
      status: input.status,
      position: input.position,
    });

    return ok(
      { id: subtask.id, taskId: subtask.taskId, title: subtask.title, status: subtask.status, position: subtask.position },
      `Updated subtask "${subtask.title}"`,
    );
  },
};

const createTaskTagArgs = z.object({
  taskId: idArg("task", "get_tasks"),
  task: refArg("task"),
  name: z.string().min(1).max(50),
  color: z.string().max(20).optional(),
});

export const createTaskTagTool: AiToolDefinition = {
  name: "create_task_tag",
  description: "Label one task with a tag. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Tagging a task",
  parameters: createTaskTagArgs,
  prepare: prepareWith([TASK_REF]),
  async execute(args, ctx) {
    const input = createTaskTagArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "task", {
      id: input.taskId,
      ref: input.task,
      entityName: "task",
    });
    const tag = await taskTagsService.create(ctx.userId, target.id, {
      name: input.name,
      ...(input.color ? { color: input.color } : {}),
    });
    return ok({ id: tag.id, taskId: tag.taskId, name: tag.name, color: tag.color }, `Tagged "${target.label}" as "${tag.name}"`);
  },
};

// ── Study sessions ──────────────────────────────────────────────────────────

const createStudySessionArgs = z.object({
  ...courseRefShape,
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
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createStudySessionArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const session = await studySessionsService.create(ctx.userId, {
      courseId,
      taskId: input.taskId,
      topic: input.topic,
      startedAt: toDate(input.startedAt) as Date,
      endedAt: toDate(input.endedAt) ?? null,
      durationMinutes: input.durationMinutes,
      focusRating: input.focusRating,
    });
    return ok(
      { id: session.id, topic: session.topic, startedAt: session.startedAt, durationMinutes: session.durationMinutes },
      `Logged study session "${session.topic ?? "untitled"}"`,
    );
  },
};

const updateStudySessionArgs = z.object({
  sessionId: idArg("study session", "get_study_sessions"),
  session: refArg("study session"),
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
  prepare: prepareWith([SESSION_REF]),
  async execute(args, ctx) {
    const input = updateStudySessionArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "session", {
      id: input.sessionId,
      ref: input.session,
      entityName: "study session",
    });

    const session = await studySessionsService.update(ctx.userId, target.id, {
      courseId: input.courseId,
      taskId: input.taskId,
      topic: input.topic,
      durationMinutes: input.durationMinutes,
      focusRating: input.focusRating,
      ...(input.startedAt !== undefined ? { startedAt: toDate(input.startedAt) as Date } : {}),
      ...(input.endedAt !== undefined ? { endedAt: toDate(input.endedAt) ?? null } : {}),
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
  goalId: idArg("goal", "get_goals_and_milestones"),
  goal: refArg("goal"),
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
  prepare: prepareWith([GOAL_REF]),
  async execute(args, ctx) {
    const input = updateGoalProgressArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "goal", {
      id: input.goalId,
      ref: input.goal,
      entityName: "goal",
    });
    const goal = await goalsService.update(ctx.userId, target.id, {
      progress: input.progress,
      status: input.status,
      title: input.title,
      deadline: toDate(input.deadline) ?? null,
    });
    return ok({ id: goal.id, title: goal.title, progress: goal.progress, status: goal.status }, `Updated goal "${goal.title}" (${goal.progress}%)`);
  },
};

const createMilestoneArgs = z.object({
  goalId: idArg("goal", "get_goals_and_milestones"),
  goal: refArg("goal"),
  title: z.string().min(1).max(200),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED"]).optional(),
});

export const createMilestoneTool: AiToolDefinition = {
  name: "create_milestone",
  description: "Add a step to one goal. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Adding a milestone",
  parameters: createMilestoneArgs,
  prepare: prepareWith([GOAL_REF]),
  async execute(args, ctx) {
    const input = createMilestoneArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "goal", {
      id: input.goalId,
      ref: input.goal,
      entityName: "goal",
    });
    const milestone = await goalsService.createMilestone(ctx.userId, target.id, {
      title: input.title,
      ...(input.status ? { status: input.status } : {}),
    });
    return ok(
      { id: milestone.id, goalId: milestone.goalId, title: milestone.title, status: milestone.status, position: milestone.position },
      `Added milestone "${milestone.title}" to "${target.label}"`,
    );
  },
};

const updateMilestoneArgs = z.object({
  milestoneId: idArg("milestone", "get_goal_milestones"),
  milestone: refArg("milestone"),
  goalId: idArg("goal", "get_goal_milestones"),
  goal: refArg("goal"),
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED"]).optional(),
  position: z.number().int().min(0).optional(),
});

export const updateMilestoneTool: AiToolDefinition = {
  name: "update_milestone",
  description: "Change or tick off one milestone of a goal. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a milestone",
  parameters: updateMilestoneArgs,
  prepare: prepareWith([MILESTONE_REF]),
  async execute(args, ctx) {
    const input = updateMilestoneArgs.parse(args);
    const parent = await requireEntityIdFromArgs(ctx.userId, "goal", {
      id: input.goalId,
      ref: input.goal,
      entityName: "goal",
    });
    const target = await requireEntityIdFromArgs(ctx.userId, "milestone", {
      id: input.milestoneId,
      ref: input.milestone,
      parentId: parent.id,
      entityName: "milestone",
    });

    const milestone = await goalsService.updateMilestone(ctx.userId, parent.id, target.id, {
      title: input.title,
      status: input.status,
      position: input.position,
    });
    return ok(
      { id: milestone.id, goalId: milestone.goalId, title: milestone.title, status: milestone.status, position: milestone.position },
      `Updated milestone "${milestone.title}"`,
    );
  },
};

// ── Notes ───────────────────────────────────────────────────────────────────

const createNoteArgs = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(20000),
  ...courseRefShape,
});

export const createNoteTool: AiToolDefinition = {
  name: "create_note",
  description: "Create one note. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a note",
  parameters: createNoteArgs,
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createNoteArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const note = await notesService.create(ctx.userId, {
      title: input.title,
      content: input.content,
      courseId,
    });
    return ok({ id: note.id, title: note.title, courseId: note.courseId }, `Created note "${note.title}"`);
  },
};

const updateNoteArgs = z.object({
  noteId: idArg("note", "get_notes or search_notes"),
  note: refArg("note"),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(20000).optional(),
  ...courseRefShape,
});

export const updateNoteTool: AiToolDefinition = {
  name: "update_note",
  description:
    "Change one note's title, body or course. Requires the student's confirmation first — send the student the new content before proposing it.",
  kind: "WRITE",
  activityLabel: "Updating a note",
  parameters: updateNoteArgs,
  prepare: prepareWith([NOTE_REF, COURSE_REF]),
  async execute(args, ctx) {
    const input = updateNoteArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "note", {
      id: input.noteId,
      ref: input.note,
      entityName: "note",
    });

    const courseId =
      input.courseId !== undefined || input.course
        ? await resolveCourseId(ctx.userId, input.courseId, input.course)
        : undefined;

    const note = await notesService.update(ctx.userId, target.id, {
      title: input.title,
      content: input.content,
      courseId,
    });
    return ok({ id: note.id, title: note.title, courseId: note.courseId, contentLength: note.content.length }, `Updated note "${note.title}"`);
  },
};

// ── Resources ───────────────────────────────────────────────────────────────

const createResourceArgs = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().describe("Link to the resource. File uploads are not supported yet."),
  description: z.string().max(2000).optional(),
  resourceType: z.enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"]).optional(),
  ...courseRefShape,
});

export const createResourceTool: AiToolDefinition = {
  name: "create_resource",
  description: "Save one link resource. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Saving a resource",
  parameters: createResourceArgs,
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createResourceArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const resource = await resourcesService.create(ctx.userId, {
      title: input.title,
      url: input.url,
      description: input.description,
      resourceType: input.resourceType,
      courseId,
      storageType: "URL",
    });
    return ok({ id: resource.id, title: resource.title, url: resource.url, courseId: resource.courseId }, `Saved resource "${resource.title}"`);
  },
};

const updateResourceArgs = z.object({
  resourceId: idArg("resource", "get_resources"),
  resource: refArg("resource"),
  title: z.string().min(1).max(200).optional(),
  url: z.string().url().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  resourceType: z.enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"]).optional(),
  ...courseRefShape,
});

export const updateResourceTool: AiToolDefinition = {
  name: "update_resource",
  description:
    "Change one saved resource's title, link, type, description or course. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a resource",
  parameters: updateResourceArgs,
  prepare: prepareWith([RESOURCE_REF, COURSE_REF]),
  async execute(args, ctx) {
    const input = updateResourceArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "resource", {
      id: input.resourceId,
      ref: input.resource,
      entityName: "resource",
    });

    const courseId =
      input.courseId !== undefined || input.course
        ? await resolveCourseId(ctx.userId, input.courseId, input.course)
        : undefined;

    const resource = await resourcesService.update(ctx.userId, target.id, {
      title: input.title,
      url: input.url,
      description: input.description,
      resourceType: input.resourceType,
      courseId,
    });
    return ok(
      { id: resource.id, title: resource.title, url: resource.url, resourceType: resource.resourceType, courseId: resource.courseId },
      `Updated resource "${resource.title}"`,
    );
  },
};

// ── Calendar events and exams ───────────────────────────────────────────────

const createEventArgs = z.object({
  title: z.string().min(1).max(200),
  type: z
    .enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"])
    .optional()
    .describe("Use EXAM for an exam, CLASS for a lecture/seminar."),
  startAt: dateArg("ISO-8601 start date and time. A date alone becomes 09:00 local time."),
  endAt: dateArg("ISO-8601 end date and time.").optional(),
  location: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  ...courseRefShape,
});

export const createEventTool: AiToolDefinition = {
  name: "create_event",
  description:
    "Add a calendar entry — an exam, class, assignment deadline, meeting or study block. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Adding a calendar event",
  parameters: createEventArgs,
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createEventArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const event = await eventsService.create(ctx.userId, {
      title: input.title,
      type: input.type,
      startAt: toDate(input.startAt) as Date,
      endAt: toDate(input.endAt) ?? null,
      location: input.location,
      description: input.description,
      courseId,
    });
    return ok(
      { id: event.id, title: event.title, type: event.type, startAt: event.startAt, location: event.location, courseId: event.courseId },
      `Added ${(event.type ?? "OTHER").toLowerCase()} "${event.title}" on ${event.startAt.slice(0, 10)}`,
    );
  },
};

const updateEventArgs = z.object({
  eventId: idArg("calendar event", "get_calendar_events or get_upcoming_exams"),
  event: refArg("calendar event"),
  title: z.string().min(1).max(200).optional(),
  type: z.enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"]).optional(),
  startAt: dateArg("New ISO-8601 start date and time.").optional(),
  endAt: z.union([z.string(), z.null()]).optional().describe("New ISO-8601 end time, or null to clear it."),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  ...courseRefShape,
});

export const updateEventTool: AiToolDefinition = {
  name: "update_event",
  description:
    "Change one calendar entry, including moving an exam to a different day or time. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a calendar event",
  parameters: updateEventArgs,
  prepare: prepareWith([EVENT_REF, COURSE_REF]),
  async execute(args, ctx) {
    const input = updateEventArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "event", {
      id: input.eventId,
      ref: input.event,
      // The date narrows same-titled events ("the Database exam") to the right
      // one before scoring.
      date: input.startAt,
      entityName: "calendar event",
    });

    const courseId =
      input.courseId !== undefined || input.course
        ? await resolveCourseId(ctx.userId, input.courseId, input.course)
        : undefined;

    const event = await eventsService.update(ctx.userId, target.id, {
      title: input.title,
      type: input.type,
      location: input.location,
      description: input.description,
      courseId,
      ...(input.startAt !== undefined ? { startAt: toDate(input.startAt) as Date } : {}),
      ...(input.endAt !== undefined ? { endAt: toDate(input.endAt) ?? null } : {}),
    });

    return ok(
      { id: event.id, title: event.title, type: event.type, startAt: event.startAt, endAt: event.endAt, location: event.location, courseId: event.courseId },
      `Updated "${event.title}" to ${event.startAt.slice(0, 10)}`,
    );
  },
};

// ── Grades ──────────────────────────────────────────────────────────────────

const createGradeArgs = z.object({
  title: z.string().min(1).max(200),
  score: z.number().min(0).nullable().optional(),
  maxScore: z.number().min(0).nullable().optional(),
  weight: z.number().min(0).nullable().optional(),
  type: z.enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"]).optional(),
  recordedAt: dateArg("When the grade was earned. Defaults to now.").optional(),
  ...courseRefShape,
});

export const createGradeTool: AiToolDefinition = {
  name: "create_grade",
  description:
    "Record a grade the student has just received. Requires the student's confirmation first, and the score must be the real number they told you.",
  kind: "WRITE",
  activityLabel: "Recording a grade",
  parameters: createGradeArgs,
  prepare: prepareWith([COURSE_REF]),
  async execute(args, ctx) {
    const input = createGradeArgs.parse(args);
    const courseId = await resolveCourseId(ctx.userId, input.courseId, input.course);
    const grade = await gradesService.create(ctx.userId, {
      title: input.title,
      score: input.score,
      maxScore: input.maxScore,
      weight: input.weight,
      type: input.type,
      recordedAt: toDate(input.recordedAt) ?? undefined,
      courseId,
    });
    return ok(
      { id: grade.id, title: grade.title, score: grade.score, maxScore: grade.maxScore, type: grade.type, courseId: grade.courseId },
      `Recorded "${grade.title}"${grade.score !== null && grade.maxScore ? ` (${grade.score}/${grade.maxScore})` : ""}`,
    );
  },
};

const updateGradeArgs = z.object({
  gradeId: idArg("grade", "get_grades"),
  grade: refArg("grade"),
  title: z.string().min(1).max(200).optional(),
  score: z.number().min(0).nullable().optional(),
  maxScore: z.number().min(0).nullable().optional(),
  weight: z.number().min(0).nullable().optional(),
  type: z.enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"]).optional(),
  recordedAt: dateArg("New date the grade was earned.").optional(),
  ...courseRefShape,
});

export const updateGradeTool: AiToolDefinition = {
  name: "update_grade",
  description:
    "Correct or add detail to one recorded grade. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a grade",
  parameters: updateGradeArgs,
  prepare: prepareWith([GRADE_REF, COURSE_REF]),
  async execute(args, ctx) {
    const input = updateGradeArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "grade", {
      id: input.gradeId,
      ref: input.grade,
      courseId: input.courseId,
      entityName: "grade",
    });

    const courseId =
      input.courseId !== undefined || input.course
        ? await resolveCourseId(ctx.userId, input.courseId, input.course)
        : undefined;

    const grade = await gradesService.update(ctx.userId, target.id, {
      title: input.title,
      score: input.score,
      maxScore: input.maxScore,
      weight: input.weight,
      type: input.type,
      courseId,
      ...(input.recordedAt !== undefined ? { recordedAt: toDate(input.recordedAt) as Date } : {}),
    });

    return ok(
      { id: grade.id, title: grade.title, score: grade.score, maxScore: grade.maxScore, type: grade.type, courseId: grade.courseId },
      `Updated grade "${grade.title}"`,
    );
  },
};

// ── Courses ─────────────────────────────────────────────────────────────────

const updateCourseArgs = z.object({
  courseId: idArg("course", "get_courses"),
  course: refArg("course"),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(20).optional(),
  credits: z.number().int().min(0).max(50).optional(),
  instructor: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]).optional().describe("Set to COMPLETED or DROPPED to archive the course."),
  semesterId: z.string().min(1).optional().describe("Move the course to another semester. Must belong to the student."),
});

export const updateCourseTool: AiToolDefinition = {
  name: "update_course",
  description:
    "Change a course's details or status, or move it to another semester. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Updating a course",
  parameters: updateCourseArgs,
  prepare: prepareWith([COURSE_TARGET_REF]),
  async execute(args, ctx) {
    const input = updateCourseArgs.parse(args);
    const target = await requireEntityIdFromArgs(ctx.userId, "course", {
      id: input.courseId,
      ref: input.course,
      entityName: "course",
    });

    const course = await coursesService.update(ctx.userId, target.id, {
      name: input.name,
      code: input.code,
      credits: input.credits,
      instructor: input.instructor,
      description: input.description,
      status: input.status,
      semesterId: input.semesterId,
    });

    return ok(
      { id: course.id, code: course.code, name: course.name, credits: course.credits, status: course.status, semesterId: course.semesterId },
      `Updated course "${course.name}"`,
    );
  },
};

export const actionTools: AiToolDefinition[] = [
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  createSubtaskTool,
  updateSubtaskTool,
  createTaskTagTool,
  createStudySessionTool,
  updateStudySessionTool,
  createGoalTool,
  updateGoalProgressTool,
  createMilestoneTool,
  updateMilestoneTool,
  createNoteTool,
  updateNoteTool,
  createResourceTool,
  updateResourceTool,
  createEventTool,
  updateEventTool,
  createGradeTool,
  updateGradeTool,
  updateCourseTool,
];
