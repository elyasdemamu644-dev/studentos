import { tasksService } from "@/services/tasks";
import { subtasksService } from "@/services/subtasks";
import { coursesService } from "@/services/courses";
import { eventsService } from "@/services/events";
import { studySessionsService } from "@/services/study-sessions";
import { goalsService } from "@/services/goals";
import { gradesService } from "@/services/grades";
import { notesService } from "@/services/notes";
import { resourcesService } from "@/services/resources";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-entity resolver
// ─────────────────────────────────────────────────────────────────────────────
//
// A student says "the Database exam", "my algorithms assignment" or "the CS201
// note" — never a cuid. Every tool that acts on one record therefore needs a
// way to turn a human reference into a real, owned id.
//
// This module is that single place. It:
//   * only ever reads through the module services, so the authenticated
//     `userId` still decides what is visible — a reference to another
//     student's course resolves to `not_found`, never to a hit,
//   * scores candidates (exact id > exact name > prefix > substring > token
//     overlap) and returns a `resolved` result only when the best candidate is
//     strictly better than the runner-up,
//   * otherwise returns `ambiguous` with the candidates and the field that
//     distinguishes them, so the agent can ask the student one short question
//     instead of guessing and writing to the wrong record,
//   * and returns `not_found` when nothing scores well enough.
//
// Nothing here mutates data and nothing here talks to Prisma directly.
export type ResolvableEntity =
  | "course"
  | "task"
  | "event"
  | "note"
  | "grade"
  | "goal"
  | "session"
  | "resource"
  | "subtask"
  | "milestone";

export interface ResolveRequest {
  entity: ResolvableEntity;
  /** An id, an exact name/code/title, or a fuzzy fragment of one. */
  query: string;
  /** Narrow the search to one course, when the caller already knows it. */
  courseId?: string | null;
  /**
   * Required for the child entities (`subtask`, `milestone`): a subtask title
   * is only meaningful inside its task, so resolution never leaves the parent.
   */
  parentId?: string | null;
  /** ISO datetime used to pick between same-titled dated records (exams). */
  date?: string | null;
  /** Extra narrowing filter, e.g. an event type. */
  type?: string | null;
  /** How many candidates to consider / return. */
  limit?: number;
}

export interface ResolvedEntity {
  status: "resolved";
  entity: ResolvableEntity;
  id: string;
  /** Human label for the record that was matched. */
  label: string;
  courseId: string | null;
  /** How confident the match is. `id` and `exact` need no clarification. */
  match: "id" | "exact" | "fuzzy";
  /** Fields worth echoing back so the model can mention what it picked. */
  detail: Record<string, unknown>;
}

export interface ResolutionCandidate {
  id: string;
  label: string;
  /** The field that tells this candidate apart from the others. */
  detail: string;
}

export interface AmbiguousEntity {
  status: "ambiguous";
  entity: ResolvableEntity;
  query: string;
  candidates: ResolutionCandidate[];
}

export interface NotFoundEntity {
  status: "not_found";
  entity: ResolvableEntity;
  query: string;
}

export type ResolutionResult = ResolvedEntity | AmbiguousEntity | NotFoundEntity;

/** Raised by `requireEntityId` so tool handlers can `try/catch` and report. */
export class EntityResolutionError extends Error {
  readonly result: Exclude<ResolutionResult, ResolvedEntity>;

  constructor(result: Exclude<ResolutionResult, ResolvedEntity>, label?: string) {
    super(resolutionMessage(result, label));
    this.name = "EntityResolutionError";
    this.result = result;
    Object.setPrototypeOf(this, EntityResolutionError.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a human reference to exactly one owned record.
 *
 * Returns a discriminated union rather than throwing: callers that want to ask
 * a question can branch on `status`, and callers that just need an id can use
 * `requireEntityId`.
 */
export async function resolveEntity(
  userId: string,
  request: ResolveRequest,
): Promise<ResolutionResult> {
  const query = request.query.trim();
  if (!query) {
    return { status: "not_found", entity: request.entity, query };
  }

  // An id short-circuits every scoring path — but only if the record is
  // actually owned by this user, which the per-entity reader still enforces.
  const candidates = await collectCandidates(userId, request, query);
  if (candidates.length === 0) {
    return { status: "not_found", entity: request.entity, query };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, query, request.entity) }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "not_found", entity: request.entity, query };
  }

  const best = scored[0]!;
  const runnerUp = scored[1];

  // A tie means the student's words genuinely point at two records. Guessing
  // here would silently write to the wrong one, so it becomes a question.
  if (runnerUp && runnerUp.score >= best.score) {
    return {
      status: "ambiguous",
      entity: request.entity,
      query,
      candidates: scored
        .slice(0, 5)
        .map((entry) => ({ id: entry.candidate.id, label: entry.candidate.label, detail: entry.candidate.detailText })),
    };
  }

  return {
    status: "resolved",
    entity: request.entity,
    id: best.candidate.id,
    label: best.candidate.label,
    courseId: best.candidate.courseId,
    match: best.match,
    detail: best.candidate.detail,
  };
}

/**
 * Resolve or fail loudly.
 *
 * Write tools use this: an ambiguous or missing reference must abort the call
 * so the registry reports the reason and the student is asked, rather than the
 * tool applying a change to an arbitrary record.
 */
export async function requireEntityId(userId: string, request: ResolveRequest): Promise<ResolvedEntity> {
  const result = await resolveEntity(userId, request);
  if (result.status !== "resolved") {
    throw new EntityResolutionError(result);
  }
  return result;
}

/**
 * Resolve a write tool's `*Id` / `*Ref` argument pair.
 *
 * An explicit id is used as-is (the service re-checks ownership); otherwise the
 * reference text goes through the resolver. Passing neither is a schema-shaped
 * error, so it is raised the same way as a failed lookup.
 */
export async function requireEntityIdFromArgs(
  userId: string,
  entity: ResolvableEntity,
  input: {
    id?: string | null;
    ref?: string | null;
    courseId?: string | null;
    parentId?: string | null;
    date?: string | null;
    type?: string | null;
    entityName?: string;
  },
): Promise<ResolvedEntity> {
  const entityName = input.entityName ?? entity;

  if (input.id && input.id.trim()) {
    return {
      status: "resolved",
      entity,
      id: input.id.trim(),
      label: input.id.trim(),
      courseId: input.courseId ?? null,
      match: "id",
      detail: {},
    };
  }

  if (input.ref && input.ref.trim()) {
    return requireEntityId(userId, {
      entity,
      query: input.ref,
      courseId: input.courseId ?? undefined,
      parentId: input.parentId ?? undefined,
      date: input.date ?? undefined,
      type: input.type ?? undefined,
    });
  }

  throw new EntityResolutionError(
    { status: "not_found", entity, query: "" },
    entityName,
  );
}

/** Model-facing sentence for a failed resolution. */
export function resolutionMessage(
  result: Exclude<ResolutionResult, ResolvedEntity>,
  label?: string,
): string {
  const name = label ?? result.entity;
  if (result.status === "not_found") {
    return `No ${name} matches "${result.query}" for this student. Read the list of ${name}s and either pick the right one or ask the student which they meant.`;
  }
  const options = result.candidates.map((c) => `${c.label} (${c.detail})`).join("; ");
  return `"${result.query}" matches more than one ${name}: ${options}. Ask the student which one they mean — do not guess.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate collection
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  label: string;
  courseId: string | null;
  /** Short disambiguator shown next to the label in a question. */
  detailText: string;
  /** Everything the scorer compares against. */
  texts: string[];
  /** Extra, non-scored context returned with a successful resolution. */
  detail: Record<string, unknown>;
}

const DEFAULT_LIMIT = 60;
const MAX_CANDIDATES_RETURNED = 5;

async function collectCandidates(userId: string, request: ResolveRequest, query: string): Promise<Candidate[]> {
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), 100);

  switch (request.entity) {
    case "course": {
      const result = await coursesService.list(userId, { limit });
      return result.items.map((course) => ({
        id: course.id,
        label: course.code ? `${course.code} — ${course.name}` : course.name,
        courseId: course.id,
        detailText: `${course.status.toLowerCase()}${course.credits ? `, ${course.credits} credits` : ""}`,
        texts: [course.name, course.code ?? "", course.description ?? ""],
        detail: { code: course.code, name: course.name, status: course.status, credits: course.credits },
      }));
    }

    case "task": {
      const result = await tasksService.list(userId, {
        limit,
        ...(request.courseId ? { courseId: request.courseId } : {}),
      });
      return result.items.map((task) => ({
        id: task.id,
        label: task.title,
        courseId: task.courseId,
        detailText: [task.course?.code ?? task.course?.name, formatWhen(task.dueDate), task.status.toLowerCase()]
          .filter(Boolean)
          .join(", "),
        texts: [task.title, task.description ?? ""],
        detail: { title: task.title, status: task.status, dueDate: task.dueDate, course: task.course },
      }));
    }

    case "event": {
      const window = dateWindow(request.date);
      const result = await eventsService.list(userId, {
        limit,
        ...(request.type ? { type: request.type as "EXAM" } : {}),
        ...(request.courseId ? { courseId: request.courseId } : {}),
        ...(window),
      });
      return result.items.map((event) => ({
        id: event.id,
        label: event.title,
        courseId: event.courseId,
        detailText: [event.course?.code ?? event.course?.name, formatWhen(event.startAt), event.type.toLowerCase(), event.location]
          .filter(Boolean)
          .join(", "),
        texts: [event.title, event.description ?? "", event.location ?? ""],
        detail: {
          title: event.title,
          type: event.type,
          startAt: event.startAt,
          location: event.location,
          course: event.course,
        },
      }));
    }

    case "note": {
      const result = await notesService.list(userId, {
        limit,
        ...(request.courseId ? { courseId: request.courseId } : {}),
      });
      return result.items.map((note) => ({
        id: note.id,
        label: note.title,
        courseId: note.courseId,
        detailText: [note.course?.code ?? note.course?.name, `updated ${formatWhen(note.updatedAt)}`]
          .filter(Boolean)
          .join(", "),
        texts: [note.title],
        detail: { title: note.title, courseId: note.courseId, course: note.course, updatedAt: note.updatedAt },
      }));
    }

    case "grade": {
      const result = await gradesService.list(userId, {
        limit,
        ...(request.courseId ? { courseId: request.courseId } : {}),
      });
      return result.items.map((grade) => ({
        id: grade.id,
        label: grade.title,
        courseId: grade.courseId,
        detailText: [
          grade.course?.code ?? grade.course?.name,
          grade.type.toLowerCase(),
          grade.score !== null && grade.maxScore ? `${grade.score}/${grade.maxScore}` : "no score",
        ]
          .filter(Boolean)
          .join(", "),
        texts: [grade.title, grade.type],
        detail: {
          title: grade.title,
          score: grade.score,
          maxScore: grade.maxScore,
          type: grade.type,
          courseId: grade.courseId,
          course: grade.course,
        },
      }));
    }

    case "goal": {
      const result = await goalsService.list(userId, { limit });
      return result.items.map((goal) => ({
        id: goal.id,
        label: goal.title,
        courseId: null,
        detailText: [goal.status.toLowerCase(), `${goal.progress}%`, `deadline ${formatWhen(goal.deadline)}`]
          .filter(Boolean)
          .join(", "),
        texts: [goal.title, goal.description ?? ""],
        detail: { title: goal.title, status: goal.status, progress: goal.progress, deadline: goal.deadline },
      }));
    }

    case "session": {
      const result = await studySessionsService.list(userId, {
        limit,
        ...(request.courseId ? { courseId: request.courseId } : {}),
      });
      return result.items.map((session) => ({
        id: session.id,
        label: session.topic ?? "Untitled study session",
        courseId: session.courseId,
        detailText: [formatWhen(session.startedAt), `${session.durationMinutes ?? 0} min`].filter(Boolean).join(", "),
        texts: [session.topic ?? ""],
        detail: {
          topic: session.topic,
          startedAt: session.startedAt,
          durationMinutes: session.durationMinutes,
          courseId: session.courseId,
        },
      }));
    }

    case "resource": {
      const result = await resourcesService.list(userId, {
        limit,
        ...(request.courseId ? { courseId: request.courseId } : {}),
      });
      return result.items.map((resource) => ({
        id: resource.id,
        label: resource.title,
        courseId: resource.courseId,
        detailText: [resource.course?.code ?? resource.course?.name, resource.resourceType.toLowerCase()]
          .filter(Boolean)
          .join(", "),
        texts: [resource.title, resource.description ?? "", resource.url ?? ""],
        detail: {
          title: resource.title,
          resourceType: resource.resourceType,
          url: resource.url,
          courseId: resource.courseId,
          course: resource.course,
        },
      }));
    }

    case "subtask": {
      // Subtasks only exist inside their task, so a parent id is mandatory and
      // the search never leaves it.
      if (!request.parentId) return [];
      const subtasks = await subtasksService.list(userId, request.parentId, {});
      return subtasks.map((subtask) => ({
        id: subtask.id,
        label: subtask.title,
        courseId: null,
        detailText: `subtask ${subtask.position + 1}, ${subtask.status.toLowerCase()}`,
        texts: [subtask.title],
        detail: { title: subtask.title, status: subtask.status, position: subtask.position, taskId: subtask.taskId },
      }));
    }

    case "milestone": {
      if (!request.parentId) return [];
      const milestones = await goalsService.listMilestones(userId, request.parentId);
      return milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.title,
        courseId: null,
        detailText: `milestone ${milestone.position + 1}, ${milestone.status.toLowerCase()}`,
        texts: [milestone.title],
        detail: {
          title: milestone.title,
          status: milestone.status,
          position: milestone.position,
          goalId: milestone.goalId,
        },
      }));
    }

    default:
      return [];
  }
}

/** ±3 days around a supplied date, so "the exam on Friday" finds Friday's row. */
function dateWindow(date: string | null | undefined): { startFrom?: string; startTo?: string } {
  if (!date) return {};
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return {};
  return {
    startFrom: new Date(parsed.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    startTo: new Date(parsed.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

const MIN_SCORE = 45;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,63}$/i;

/**
 * How well one candidate matches the student's words.
 *
 * The tiers are deliberately coarse and ordered: an id or an exact title is
 * conclusive, a prefix is nearly so, a substring or partial token overlap is a
 * guess. Two candidates landing in the same tier is the ambiguity case.
 */
function scoreCandidate(
  candidate: Candidate,
  query: string,
  entity: ResolvableEntity,
): { score: number; match: ResolvedEntity["match"] } {
  if (ID_PATTERN.test(query)) {
    if (candidate.id.toLowerCase() === query.toLowerCase()) {
      return { score: 1000, match: "id" };
    }
  }

  const needle = normalize(query);
  if (!needle) return { score: 0, match: "fuzzy" };

  // A course code is written both ways in the wild — "PSYC300" and "PSYC 300" —
  // so a match that only differs by spaces is still the same reference.
  const squashedNeedle = needle.replace(/ /g, "");

  let best = 0;
  for (const raw of candidate.texts) {
    const text = normalize(raw);
    if (!text) continue;
    if (text === needle) return { score: 500, match: "exact" };
    if (text.replace(/ /g, "") === squashedNeedle) return { score: 480, match: "exact" };
    if (text.startsWith(needle) || needle.startsWith(text)) best = Math.max(best, 300);
    else if (text.includes(needle)) best = Math.max(best, 240);
    else {
      const overlap = tokenOverlap(needle, text);
      if (overlap >= 0.6) best = Math.max(best, 160 + Math.round(overlap * 80));
    }
  }

  // A course reference that matches the code exactly is as conclusive as a name.
  if (entity === "course" && best > 0 && best < 300) best += 20;

  return { score: best, match: best >= 300 ? "exact" : "fuzzy" };
}

/** Fraction of the query's words that appear in the candidate's text. */
function tokenOverlap(needle: string, text: string): number {
  const needleTokens = needle.split(" ").filter((t) => t.length > 1);
  if (needleTokens.length === 0) return 0;
  const textTokens = new Set(text.split(" "));
  const hits = needleTokens.filter((token) => textTokens.has(token)).length;
  return hits / needleTokens.length;
}

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
