import { tasksService } from "@/services/tasks";
import { subtasksService } from "@/services/subtasks";
import { taskTagsService } from "@/services/task-tags";
import { studySessionsService } from "@/services/study-sessions";
import { goalsService } from "@/services/goals";
import { notesService } from "@/services/notes";
import { resourcesService } from "@/services/resources";
import { eventsService } from "@/services/events";
import { gradesService } from "@/services/grades";
import { coursesService } from "@/services/courses";
import { aiService } from "@/services/ai/service";

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
  /** Trimmed re-read record (null when the re-read found nothing), so the UI
   * and the model see the real values. */
  record?: Record<string, unknown> | null;
}

/** How to re-read one kind of record, and which arguments to check. */
interface Verifier {
  read(
    userId: string,
    id: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  /** Approved-argument key → record key. Only checked when the arg was sent. */
  fields: Record<string, string>;
  /**
   * A condition the record must satisfy whatever the student approved, for a
   * tool whose whole purpose is that outcome (`complete_task` ⇒ COMPLETED),
   * or for a shape the field map cannot express (a list of approved entries).
   * Receives the approved arguments so a comparison can be made against them.
   * Returns a mismatch description, or `null` when the record is correct.
   */
  expect?: (record: Record<string, unknown> | null, args: Record<string, unknown>) => string | null;
  /** Fields quoted back in the verification message. */
  report: string[];
  /**
   * True when the payload carries no single record id (a bulk write). The
   * record-id contract is then skipped and `read` is called with the approved
   * arguments so it can re-read every record the write touched.
   */
  noRecordId?: boolean;
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
      if (!record) return "the task no longer exists";
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
  create_course: {
    read: async (userId, id) => await coursesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { name: "name", code: "code", description: "description", credits: "credits", instructor: "instructor", semesterId: "semesterId" },
    report: ["code", "name", "credits", "status"],
  },
  update_course: {
    read: async (userId, id) => await coursesService.getById(userId, id) as unknown as Record<string, unknown>,
    fields: { name: "name", code: "code", description: "description", credits: "credits", status: "status", semesterId: "semesterId", instructor: "instructor" },
    report: ["code", "name", "credits", "status"],
  },

  // ── Deletes ─────────────────────────────────────────────────────────────
  //
  // A delete verifies by the *opposite* of every other verifier: the record
  // must NOT come back. `expect` reports a mismatch when the row still exists,
  // so a delete that silently failed is reported as unverified rather than as
  // a success. The domain services throw NotFoundError for a missing row, so
  // `read` swallows it and returns null instead of aborting the verification.
  delete_task: {
    read: async (userId, id) => {
      try {
        return await tasksService.getById(userId, id) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    fields: {},
    expect: (record) => (record ? "the task still exists" : null),
    report: [],
  },
  delete_note: {
    read: async (userId, id) => {
      try {
        return await notesService.getById(userId, id) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    fields: {},
    expect: (record) => (record ? "the note still exists" : null),
    report: [],
  },
  delete_study_session: {
    read: async (userId, id) => {
      try {
        return await studySessionsService.getById(userId, id) as unknown as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    fields: {},
    expect: (record) => (record ? "the study session still exists" : null),
    report: [],
  },

  // ── Study plans ─────────────────────────────────────────────────────────
  //
  // `entries` is an array, so it is compared by `expect` rather than by the
  // field map: the check is that every approved entry is present with its
  // approved title, duration and description, which a plain key→key map
  // cannot express.
  create_study_plan: {
    read: async (userId, id) => (await aiService.getStudyPlan(userId, id)) as unknown as Record<string, unknown>,
    fields: { title: "title", examDate: "examDate", courseId: "courseId", entries: "entries" },
    expect: (record, args) => {
      if (!record) return "the study plan was not created";
      const stored = Array.isArray(record.entries) ? (record.entries as Array<Record<string, unknown>>) : [];
      const approved = Array.isArray(args.entries) ? (args.entries as Array<Record<string, unknown>>) : [];

      // Every approved entry must be present, with its approved title,
      // duration and description. A dropped or renumbered entry is a mismatch,
      // not a success — the count alone is not evidence.
      for (const entry of approved) {
        const dayNumber = typeof entry.dayNumber === "number" ? entry.dayNumber : -1;
        const title = typeof entry.title === "string" ? entry.title : "";
        const match = stored.find((candidate) => candidate.title === title);
        if (!match) return `approved entry "${title}" was not stored`;
        if (match.dayNumber !== dayNumber) {
          return `entry "${title}" is on day ${format(match.dayNumber)}, not the approved day ${format(dayNumber)}`;
        }
        if (Number(match.durationMinutes) !== Number(entry.durationMinutes)) {
          return `entry "${title}" is ${format(match.durationMinutes)} minutes, not the approved ${format(entry.durationMinutes)}`;
        }
      }

      if (stored.length < approved.length) {
        return `the plan stored ${stored.length} entr(ies) but ${approved.length} were approved`;
      }
      return null;
    },
    report: ["title", "examDate"],
  },
  add_study_plan_entry: {
    // The tool returns the *plan* id, so the plan is re-read and the entry is
    // found inside it by the approved title.
    read: async (userId, id, args) => {
      const plan = (await aiService.getStudyPlan(userId, id)) as unknown as {
        entries: Array<Record<string, unknown>>;
      };
      const wanted = typeof args.title === "string" ? args.title : "";
      return plan.entries.find((entry) => entry.title === wanted) ?? null;
    },
    fields: { title: "title", dayNumber: "dayNumber", durationMinutes: "durationMinutes", description: "description" },
    expect: (record) => (record ? null : "the entry was not found on the plan"),
    report: ["title", "dayNumber", "durationMinutes"],
  },
  bulk_update_task_status: {
    // A bulk update has no single record, so it carries no record id. `read`
    // re-reads every task the approved payload named, through the same
    // ownership-scoped service that wrote them, and reports the re-read status
    // of each one in a `tasks` array — a task that was not stored, or that
    // still holds its old status, is a mismatch, never a success.
    noRecordId: true,
    read: async (userId, _id, args) => {
      const ids = Array.isArray(args.taskIds) ? (args.taskIds as string[]) : [];
      const tasks: Array<{ taskId: string; status: string | null }> = [];
      for (const taskId of ids) {
        try {
          const task = await tasksService.getById(userId, taskId);
          tasks.push({ taskId: task.id, status: task.status });
        } catch {
          tasks.push({ taskId, status: null });
        }
      }
      // A single top-level `status` the field map can compare: the approved
      // status only when every re-read task holds it, otherwise null so the
      // generic comparison surfaces a mismatch.
      const approved = String(args.status);
      const allMatch = tasks.length > 0 && tasks.every((task) => task.status === approved);
      return { status: allMatch ? approved : null, tasks };
    },
    fields: { status: "status" },
    expect: (record, args) => {
      if (!record) return "none of the tasks could be re-read";
      const tasks = Array.isArray(record.tasks) ? (record.tasks as Array<{ taskId: string; status: string | null }>) : [];
      if (tasks.length === 0) return "no task held the approved status";
      const wanted = String(args.status);
      const wrong = tasks.filter((task) => task.status !== wanted);
      if (wrong.length > 0) {
        return `${wrong.length} task(s) are not ${format(wanted)}: ${wrong.map((task) => format(task.taskId)).join(", ")}`;
      }
      return null;
    },
    report: ["status"],
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
  if (!recordId && !verifier.noRecordId) {
    return { verified: false, message: `${tool} did not report a record id, so the change could not be verified.` };
  }

  let record: Record<string, unknown> | null;
  try {
    record = await verifier.read(userId, recordId ?? "", args);
  } catch {
    return {
      verified: false,
      message: `The record was written but could not be read back, so the change could not be verified.`,
    };
  }

  const mismatches: string[] = [];

  // The tool's own invariant first, so a broken `complete_task` cannot verify.
  if (verifier.expect) {
    const invariant = verifier.expect(record, args);
    if (invariant) mismatches.push(invariant);
  }

  // A record that never came back cannot carry fields — only `expect` (a
  // delete, a bulk write) can judge it.
  if (record) {
    for (const [argKey, recordKey] of Object.entries(verifier.fields)) {
      if (!(argKey in args)) continue;
      const expected = args[argKey];
      if (expected === undefined) continue;
      const actual = record[recordKey];
      if (!matches(expected, actual)) {
        mismatches.push(`${recordKey} (expected ${format(expected)}, found ${format(actual)})`);
      }
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

  // An approved list is compared element by element. `expect` does the
  // element-aware check for the tools that need it; this keeps the generic
  // path from reporting a false mismatch on two equal arrays.
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => matches(item, actual[index]));
  }

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
function describeRecord(record: Record<string, unknown> | null, keys: string[]): string {
  if (record === null) return "no record to describe";
  const parts = keys
    .map((key) => {
      const value = record[key];
      if (value === null || value === undefined || value === "") return null;
      return `${key}=${typeof value === "string" && value.length > 60 ? `${value.slice(0, 60)}…` : format(value)}`;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : "record re-read successfully";
}
