import { z } from "zod";

import { tasksService } from "@/services/tasks";
import { notesService } from "@/services/notes";
import { studySessionsService } from "@/services/study-sessions";
import { aiService } from "@/services/ai/service";

import { ok } from "./types";
import type { AiToolDefinition } from "./types";

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
  planId: z
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
    const entry = await aiService.addEntry(ctx.userId, input.planId, {
      dayNumber: input.dayNumber,
      title: input.title,
      description: input.description,
      durationMinutes: input.durationMinutes,
      taskId: input.taskId,
      courseId: input.courseId,
    });
    // The verifier re-reads the *plan* to find this entry, so the payload
    // carries the plan id, not the entry id.
    return ok({ id: input.planId, entry }, `Added entry to study plan`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AGENDA / BULK TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const pushDailyAgendaArgs = z.object({
  planId: z
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
    "Build a day-by-day agenda from a study plan the student can already see: each plan entry mapped to a concrete date with its duration. Changes nothing. Use when the student asks what to do and when.",
  kind: "ANALYZE",
  activityLabel: "Building your daily agenda",
  parameters: pushDailyAgendaArgs,
  async execute(args, ctx) {
    const input = pushDailyAgendaArgs.parse(args);
    // The plan the student named is the one read — never the newest plan.
    const plan = await aiService.getStudyPlan(ctx.userId, input.planId);

    const sortedEntries = [...plan.entries].sort((a, b) => a.dayNumber - b.dayNumber);

    const agenda: Array<{
      dayNumber: number;
      studyDate: string;
      title: string;
      description: string | null;
      durationMinutes: number;
      status: string;
      taskId: string | null;
    }> = [];
    const usedDayNumbers = new Set<number>();
    for (const entry of sortedEntries) {
      let targetDay = entry.dayNumber;
      while (usedDayNumbers.has(targetDay)) targetDay += 1;
      usedDayNumbers.add(targetDay);

      agenda.push({
        dayNumber: targetDay,
        studyDate: new Date(new Date(input.date).getTime() + (targetDay - 1) * 24 * 60 * 60 * 1000).toISOString(),
        title: entry.title,
        description: entry.description,
        durationMinutes: entry.durationMinutes,
        status: entry.status,
        taskId: entry.taskId,
      });
    }

    return ok(
      {
        studyPlanId: plan.id,
        title: plan.title,
        date: input.date,
        hoursPerDay: input.hoursPerDay,
        entries: agenda,
        totalDays: usedDayNumbers.size,
        totalMinutes: agenda.reduce((sum, e) => sum + e.durationMinutes, 0),
      },
      `Built daily agenda for study plan`,
    );
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

    // Settled per task, never all-or-nothing: one id that does not exist or
    // belongs to another student must not roll back the rest, and it must not
    // be reported as a success either. Each outcome is named so the student
    // sees exactly which tasks changed.
    const settled = await Promise.all(
      input.taskIds.map(async (taskId) => {
        try {
          const task = await tasksService.update(ctx.userId, taskId, { status: input.status });
          return { taskId, ok: true as const, title: task.title };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return { taskId, ok: false as const, error: message };
        }
      }),
    );

    const updated = settled.filter((r) => r.ok);
    const failed = settled.filter((r) => !r.ok);

    return ok(
      {
        status: input.status,
        requested: input.taskIds.length,
        updated: updated.map((r) => r.taskId),
        updatedCount: updated.length,
        failed: failed.map((r) => ({ taskId: r.taskId, error: r.error })),
        failedCount: failed.length,
      },
      `Updated ${updated.length} of ${input.taskIds.length} task(s) to ${input.status}`,
    );
  },
};
