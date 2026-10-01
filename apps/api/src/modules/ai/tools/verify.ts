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

// ─────────────────────────────────────────────────────────────────────────────
// Post-write verification
// ─────────────────────────────────────────────────────────────────────────────
//
// "The write returned ok" is not the same as "the record changed". A service
// can report success and a later read can disagree — a silently dropped field, a
// trigger, a partial write. So after the student confirms a proposal, every
// action is *re-read through the same domain service that wrote it*, and the
// fields the student actually approved are compared against what the record now
// holds.
//
// The result is what the assistant is allowed to claim. An action that executed
// but did not verify is reported as a failure, never as a success.

export interface ActionVerification {
  /** True only when the record was re-read and matched what was approved. */
  verified: boolean;
  /** One truthful sentence about the record's current state. */
  message: string;
  /** Trimmed re-read record, so the UI and the model see the real values. */
  record?: Record<string, unknown>;
}

/** How to re-read one kind of record, and which arguments to check. */
interface Verifier {
  read(
    userId: string,
    id: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Approved-argument key → record key. Only checked when the arg was sent. */
  fields: Record<string, string>;
  /**
   * A condition the record must satisfy whatever the student approved, for a
   * tool whose whole purpose is that outcome (`complete_task` ⇒ COMPLETED).
   * Returns a mismatch description, or `null` when the record is correct.
   */
  expect?: (record: Record<string, unknown>) => string | null;
  /** Fields quoted back in the verification message. */
  report: string[];
}

/**
 * Find a child record inside its parent's list (subtasks, tags, milestones).
 *
 * Throws when the child is gone, so the verification is reported as a failure
 * instead of silently passing on an empty list.
 */
function requireChild(
  items: Array<Record<string, unknown>>,
  id: string,
  label: string,
): Record<string, unknown> {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`${label} ${id} was not found in its parent record`);
  return found;
}

const VERIFIERS: Record<string, Verifier> = {
  // ── Tasks ───────────────────────────────────────────────────────────────
  create_task: {
    read: async (userId, id) => await tasksService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", type: "type", priority: "priority", status: "status", dueDate: "dueDate", estimatedMinutes: "estimatedMinutes", courseId: "courseId" },
    report: ["title", "status", "priority", "dueDate"],
  },
  update_task: {
    read: async (userId, id) => await tasksService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", type: "type", priority: "priority", status: "status", dueDate: "dueDate", estimatedMinutes: "estimatedMinutes", courseId: "courseId" },
    report: ["title", "status", "dueDate"],
  },
  complete_task: {
    read: async (userId, id) => await tasksService.getById(userId, id) as unknown as Record<string, unknown>,
    // `complete_task` takes no status argument — completing is the whole point
    // of the tool — so there is nothing in `args` to compare against. The
    // expected outcome is checked directly instead, otherwise the field loop
    // would skip it and the action would verify on the title alone.
    expect: (record) => {
      if (record.status !== "COMPLETED") {
        return `status (expected COMPLETED, found ${format(record.status)})`;
      }
      return null;
    },
    fields: {},
    report: ["title", "status", "completedAt"],
  },
  create_subtask: {
    read: async (userId, id, args) =>
      requireChild(
        (await subtasksService.list(userId, String(args.taskId), {})) as unknown as Array<Record<string, unknown>>,
        id,
        "Subtask",
      ),
    fields: { title: "title", status: "status" },
    report: ["title", "status", "position"],
  },
  update_subtask: {
    read: async (userId, id, args) =>
      requireChild(
        (await subtasksService.list(userId, String(args.taskId), {})) as unknown as Array<Record<string, unknown>>,
        id,
        "Subtask",
      ),
    fields: { title: "title", status: "status", position: "position" },
    report: ["title", "status", "position"],
  },
  create_task_tag: {
    read: async (userId, id, args) =>
      requireChild(
        (await taskTagsService.list(userId, String(args.taskId))) as unknown as Array<Record<string, unknown>>,
        id,
        "Tag",
      ),
    fields: { name: "name", color: "color" },
    report: ["name", "color"],
  },

  // ── Study sessions ──────────────────────────────────────────────────────
  create_study_session: {
    read: async (userId, id) => await studySessionsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { topic: "topic", startedAt: "startedAt", endedAt: "endedAt", durationMinutes: "durationMinutes", focusRating: "focusRating", courseId: "courseId" },
    report: ["topic", "startedAt", "durationMinutes"],
  },
  update_study_session: {
    read: async (userId, id) => await studySessionsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { topic: "topic", startedAt: "startedAt", endedAt: "endedAt", durationMinutes: "durationMinutes", focusRating: "focusRating" },
    report: ["topic", "startedAt", "durationMinutes"],
  },

  // ── Goals and milestones ────────────────────────────────────────────────
  create_goal: {
    read: async (userId, id) => await goalsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", deadline: "deadline" },
    report: ["title", "progress", "deadline"],
  },
  update_goal_progress: {
    read: async (userId, id) => await goalsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", progress: "progress", status: "status", deadline: "deadline" },
    report: ["title", "progress", "status"],
  },
  create_milestone: {
    read: async (userId, id, args) =>
      requireChild(
        (await goalsService.listMilestones(userId, String(args.goalId))) as unknown as Array<Record<string, unknown>>,
        id,
        "Milestone",
      ),
    fields: { title: "title", status: "status" },
    report: ["title", "status", "position"],
  },
  update_milestone: {
    read: async (userId, id, args) =>
      requireChild(
        (await goalsService.listMilestones(userId, String(args.goalId))) as unknown as Array<Record<string, unknown>>,
        id,
        "Milestone",
      ),
    fields: { title: "title", status: "status", position: "position" },
    report: ["title", "status", "position"],
  },

  // ── Notes ───────────────────────────────────────────────────────────────
  create_note: {
    read: async (userId, id) => await notesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", content: "content", courseId: "courseId" },
    report: ["title", "courseId"],
  },
  update_note: {
    read: async (userId, id) => await notesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", content: "content", courseId: "courseId" },
    report: ["title", "courseId"],
  },

  // ── Resources ───────────────────────────────────────────────────────────
  create_resource: {
    read: async (userId, id) => await resourcesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", url: "url", resourceType: "resourceType", courseId: "courseId" },
    report: ["title", "url", "resourceType"],
  },
  update_resource: {
    read: async (userId, id) => await resourcesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", url: "url", resourceType: "resourceType", courseId: "courseId" },
    report: ["title", "url", "resourceType"],
  },

  // ── Calendar ────────────────────────────────────────────────────────────
  create_event: {
    read: async (userId, id) => await eventsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", type: "type", startAt: "startAt", endAt: "endAt", location: "location", courseId: "courseId" },
    report: ["title", "type", "startAt", "location"],
  },
  update_event: {
    read: async (userId, id) => await eventsService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", description: "description", type: "type", startAt: "startAt", endAt: "endAt", location: "location", courseId: "courseId" },
    report: ["title", "type", "startAt", "location"],
  },

  // ── Grades ──────────────────────────────────────────────────────────────
  create_grade: {
    read: async (userId, id) => await gradesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", score: "score", maxScore: "maxScore", weight: "weight", type: "type", recordedAt: "recordedAt", courseId: "courseId" },
    report: ["title", "score", "maxScore", "type"],
  },
  update_grade: {
    read: async (userId, id) => await gradesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { title: "title", score: "score", maxScore: "maxScore", weight: "weight", type: "type", recordedAt: "recordedAt" },
    report: ["title", "score", "maxScore", "type"],
  },

  // ── Courses ─────────────────────────────────────────────────────────────
  update_course: {
    read: async (userId, id) => await coursesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { name: "name", code: "code", description: "description", credits: "credits", status: "status", semesterId: "semesterId", instructor: "instructor" },
    report: ["code", "name", "credits", "status"],
  },
};

/** Verifiers keyed by tool name, exported for tests. */
export const verificationTools = Object.keys(VERIFIERS);

/**
 * The approved-argument keys a tool's verifier re-reads, exported so a test can
 * assert that no write tool changes a field verification ignores. Without this
 * the field map is only checked by inspection, and an argument added to a tool
 * would silently stop being verified.
 */
export function verificationFields(tool: string): string[] {
  return Object.keys(VERIFIERS[tool]?.fields ?? {});
}

/**
 * Re-read the record a write tool just touched and check the approved fields.
 *
 * Returns `verified: false` — never throws — when the record cannot be found or
 * a field does not match, so a partial application is reported as a failure
 * rather than swallowed.
 */
export async function verifyExecutedAction(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): Promise<ActionVerification> {
  const verifier = VERIFIERS[tool];
  if (!verifier) {
    return { verified: false, message: `No verification is defined for ${tool}.` };
  }

  const recordId = readRecordId(result);
  if (!recordId) {
    return { verified: false, message: `${tool} did not report a record id, so the change could not be verified.` };
  }

  let record: Record<string, unknown>;
  try {
    record = await verifier.read(userId, recordId, args);
  } catch {
    return {
      verified: false,
      message: `The record was written but could not be read back, so the change could not be verified.`,
    };
  }

  const mismatches: string[] = [];

  // The tool's own invariant first, so a broken `complete_task` cannot verify.
  if (verifier.expect) {
    const invariant = verifier.expect(record);
    if (invariant) mismatches.push(invariant);
  }

  for (const [argKey, recordKey] of Object.entries(verifier.fields)) {
    if (!(argKey in args)) continue;
    const expected = args[argKey];
    if (expected === undefined) continue;
    const actual = record[recordKey];
    if (!matches(expected, actual)) {
      mismatches.push(`${recordKey} (expected ${format(expected)}, found ${format(actual)})`);
    }
  }

  const state = describeRecord(record, verifier.report);

  if (mismatches.length > 0) {
    return {
      verified: false,
      message: `The record exists but does not match what was approved: ${mismatches.join("; ")}.`,
      record,
    };
  }

  return { verified: true, message: `Verified: ${state}`, record };
}

/** Tools return `{ id }` at the top level; a few nest it under `task`/`note`. */
function readRecordId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const direct = (result as { id?: unknown }).id;
  if (typeof direct === "string" && direct.length > 0) return direct;
  return null;
}

/**
 * Compare an approved argument with the stored value.
 *
 * Timestamps depend on what the student actually approved. A bare date
 * ("2026-01-15") is normalised to 09:00 local by the tool, and only the day was
 * ever asked for, so the day is what is compared — but when the approval carries
 * a time ("2026-01-15T14:00") the exact instant is compared, because an exam
 * moved from 14:00 to 09:00 is a different exam and must not read as verified.
 * Both sides parse the same string in the same zone, so the instants are
 * directly comparable.
 */
function matches(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (actual === null || actual === undefined) return false;
  if (typeof expected === "number") return Number(actual) === expected;
  if (typeof expected === "boolean") return actual === expected;

  const expectedText = String(expected);
  const actualText = String(actual);

  const expectedDate = new Date(expectedText);
  const actualDate = new Date(actualText);
  const bothDates =
    !Number.isNaN(expectedDate.getTime()) &&
    !Number.isNaN(actualDate.getTime()) &&
    /^\d{4}-\d{2}-\d{2}/.test(expectedText) &&
    /^\d{4}-\d{2}-\d{2}/.test(actualText);
  if (bothDates) {
    // A date with no time component only ever asked for the day.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(expectedText.trim());
    if (dateOnly) {
      return expectedDate.toISOString().slice(0, 10) === actualDate.toISOString().slice(0, 10);
    }
    return expectedDate.getTime() === actualDate.getTime();
  }

  if (expectedText.trim().toLowerCase() === actualText.trim().toLowerCase()) return true;

  // Free-text fields (a note body, a task description) are compared by a
  // normalised form so trailing whitespace does not read as a mismatch.
  return expectedText.trim().replace(/\s+/g, " ") === actualText.trim().replace(/\s+/g, " ");
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  const text = typeof value === "string" ? value : String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** `title=Database essay, status=COMPLETED` — only the fields worth quoting. */
function describeRecord(record: Record<string, unknown>, keys: string[]): string {
  const parts = keys
    .map((key) => {
      const value = record[key];
      if (value === null || value === undefined || value === "") return null;
      return `${key}=${typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}…` : format(value)}`;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : "record re-read successfully";
}
