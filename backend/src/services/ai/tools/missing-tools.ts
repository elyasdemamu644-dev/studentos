import { z } from "zod";

import { tasksService } from "@/services/tasks";
import { notesService } from "@/services/notes";
import { studySessionsService } from "@/services/study-sessions";
import { aiService } from "@/services/ai/service";
import { NotFoundError } from "@/config/errors";

import { ok, toIsoTimestamp } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// WRITE tools (action tools)
// ─────────────────────────────────────────────────────────────────────────────
// These change StudentOS data, so two constraints apply:
//
//  1. They run through the existing module services — never Prisma — so the
//     normal ownership checks, validation and business rules still apply. A
//     courseId from another student resolves to 404 inside the service, exactly
//     as it would over HTTP.
//  2. They are blocked by the registry unless the student has confirmed this
//     exact call. The confirmation gate lives in registry.ts, not here, so a
//     new write tool cannot forget it.

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const taskIdArg = z
  .string()
  .min(1)
  .describe("The id of the task to delete.");

const deleteTaskArgs = z.object({
  taskId: taskIdArg,
});

export const deleteTaskTool: AiToolDefinition = {
  name: "delete_task",
  description:
    "Delete a task permanently. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Deleting a task",
  parameters: deleteTaskArgs,
  async execute(args, ctx) {
    const input = deleteTaskArgs.parse(args);
    await tasksService.delete(ctx.userId, input.taskId);
    // The id is echoed back so the post-write verifier can re-read the record
    // and prove it is actually gone, rather than trusting a `{deleted:true}`.
    return ok({ id: input.taskId, deleted: true }, `Deleted task`);
  },
};

const noteIdArg = z
  .string()
  .min(1)
  .describe("The id of the note to delete.");

const deleteNoteArgs = z.object({
  noteId: noteIdArg,
});

export const deleteNoteTool: AiToolDefinition = {
  name: "delete_note",
  description:
    "Delete a note permanently. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Deleting a note",
  parameters: deleteNoteArgs,
  async execute(args, ctx) {
    const input = deleteNoteArgs.parse(args);
    await notesService.delete(ctx.userId, input.noteId);
    return ok({ id: input.noteId, deleted: true }, `Deleted note`);
  },
};

const deleteStudySessionArgs = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe("The id of the study session to delete."),
});

export const deleteStudySessionTool: AiToolDefinition = {
  name: "delete_study_session",
  description:
    "Delete a study session permanently. Requires the student's confirmation.",
  kind: "WRITE",
  activityLabel: "Deleting a study session",
  parameters: deleteStudySessionArgs,
  async execute(args, ctx) {
    const input = deleteStudySessionArgs.parse(args);
    await studySessionsService.delete(ctx.userId, input.sessionId);
    return ok({ id: input.sessionId, deleted: true }, `Deleted study session`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STUDY PLAN PERSISTENCE TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const createStudyPlanArgs = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200),
  examDate: z
    .string()
    .nullable()
    .optional()
    .describe("ISO-8601 date or date-time. A bare date (2026-01-15) becomes 09:00 local."),
  courseId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("The course this plan belongs to, if any."),
  entries: z
    .array(
      z.object({
        dayNumber: z.number().int().min(1).describe("Day number within the plan."),
        title: z.string().trim().min(1).max(200).describe("Title of the entry."),
        description: z.string().trim().max(2000).nullable().optional().describe("Optional description."),
        durationMinutes: z.number().int().min(1).max(1440).describe("Minutes to study."),
      }),
    )
    .max(100)
    .optional()
    .describe("Optional initial entries."),
});

export const createStudyPlanTool: AiToolDefinition = {
  name: "create_study_plan",
  description:
    "Create a new study plan (a schedule of day-numbered entries leading up to an exam). Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Creating a study plan",
  parameters: createStudyPlanArgs,
  async execute(args, ctx) {
    const input = createStudyPlanArgs.parse(args);
    const result = await aiService.createStudyPlan(ctx.userId, {
      title: input.title,
      examDate: input.examDate,
      courseId: input.courseId,
      entries: input.entries?.map((e) => ({
        dayNumber: e.dayNumber,
        title: e.title,
        description: e.description,
        durationMinutes: e.durationMinutes,
      })),
    });
    return ok(result, `Created study plan "${result.title}"`);
  },
};

const addStudyPlanEntryArgs = z.object({
  studyPlanId: z
    .string()
    .min(1)
    .describe("The id of the study plan to add an entry to."),
  dayNumber: z.number().int().min(1).describe("Day number within the plan."),
  title: z.string().trim().min(1).max(200).describe("Title of the entry."),
  description: z.string().trim().max(2000).nullable().optional().describe("Optional description."),
  durationMinutes: z.number().int().min(1).max(1440).describe("Minutes to study."),
  taskId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Optional task this entry relates to."),
  courseId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Optional course this entry belongs to."),
});

export const addStudyPlanEntryTool: AiToolDefinition = {
  name: "add_study_plan_entry",
  description:
    "Add one entry to an existing study plan. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Adding a study plan entry",
  parameters: addStudyPlanEntryArgs,
  async execute(args, ctx) {
    const input = addStudyPlanEntryArgs.parse(args);
    const result = await aiService.addEntry(ctx.userId, input.studyPlanId, {
      dayNumber: input.dayNumber,
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      taskId: input.taskId,
      courseId: input.courseId,
    });
    return ok(result, `Added entry to study plan`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AGENDA / BULK TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const pushDailyAgendaArgs = z.object({
  studyPlanId: z
    .string()
    .min(1)
    .describe("The id of the study plan to build the agenda from."),
  date: z
    .string()
    .min(1)
    .describe("The date for the agenda (YYYY-MM-DD). Entries are assigned to days around this date."),
  hoursPerDay: z.number().int().min(1).max(16).optional().default(6).describe("Hours available per day (default 6)."),
});

export const pushDailyAgendaTool: AiToolDefinition = {
  name: "push_daily_agenda",
  description:
    "Generate a day-by-day daily agenda for a study plan. Walks the plan day-by-day and assigns study slots, so the student has a concrete schedule to follow. Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Pushing a daily agenda",
  parameters: pushDailyAgendaArgs,
  async execute(args, ctx) {
    const input = pushDailyAgendaArgs.parse(args);
    const cursor = { take: 101, cursor: null };
    const { items: planItems, hasMore } = await aiService.listStudyPlans(
      ctx.userId,
      { limit: 1, cursor: null },
    );
    const plan = planItems[0];
    if (!plan) throw new NotFoundError("Study plan not found");

    const planEntries = await aiService.listStudyPlanEntries(
      ctx.userId,
      plan.id,
    );

    const agenda = [];
    const usedDayNumbers = new Set<number>();
    const sortedEntries = [...planEntries].sort((a, b) => a.dayNumber - b.dayNumber);

    for (const entry of sortedEntries) {
      let targetDay = entry.dayNumber;
      while (usedDayNumbers.has(targetDay)) targetDay += 1;
      usedDayNumbers.add(targetDay);

      agenda.push({
        dayNumber: targetDay,
        studyDate: input.date
          ? new Date(new Date(input.date).getTime() + (targetDay - 1) * 24 * 60 * 60 * 1000).toISOString()
          : null,
        title: entry.title,
        description: entry.description,
        durationMinutes: entry.durationMinutes,
        status: entry.status,
        taskId: entry.taskId,
      });
    }

    const result = {
      studyPlanId: plan.id,
      title: plan.title,
      date: input.date,
      hoursPerDay: input.hoursPerDay,
      entries: agenda,
      totalDays: usedDayNumbers.size,
      totalMinutes: agenda.reduce((sum, e) => sum + e.durationMinutes, 0),
    };

    return ok(result, `Built daily agenda for study plan`);
  },
};

const bulkUpdateTaskStatusArgs = z.object({
  taskIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("The ids of the tasks to update."),
  status: z
    .enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .describe("The new status to apply to all listed tasks."),
  courseId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Optional course to scope the update to."),
});

export const bulkUpdateTaskStatusTool: AiToolDefinition = {
  name: "bulk_update_task_status",
  description:
    "Change the status of several tasks at once (e.g. mark them all COMPLETED). Requires the student's confirmation first.",
  kind: "WRITE",
  activityLabel: "Bulk-updating task statuses",
  parameters: bulkUpdateTaskStatusArgs,
  async execute(args, ctx) {
    const input = bulkUpdateTaskStatusArgs.parse(args);
    const results = await Promise.all(
      input.taskIds.map((taskId) =>
        tasksService.update(ctx.userId, taskId, { status: input.status }),
      ),
    );
    return ok(
      { updated: results.length, results: results.map((r) => r.id) },
      `Updated ${results.length} task(s) to ${input.status}`,
    );
  },
};
