import { studentContextBuilder, type StudentContext } from "./context";

// ─────────────────────────────────────────────────────────────────────────────
// Unified academic context layer
// ─────────────────────────────────────────────────────────────────────────────
//
// `StudentContext` (see `./context`) is the *broad*, unranked snapshot: "here is
// roughly what this student has". That is enough to orient a model, but it is
// not enough to ground a specific question — a student asking about "CS204"
// gets the same thirty courses as one asking about their week.
//
// This layer turns that snapshot into a *targeted* view for the turn:
//
//  * relevance   — courses are ranked against the words of the actual question,
//                  and the strongest matches are expanded with the records that
//                  reference them (the cross-entity relationships);
//  * provenance  — every block carries where it came from, and the summary names
//                  the record types that actually grounded it;
//  * honesty     — gaps (no term covering today, no matching course, no grades)
//                  are stated plainly instead of being hidden;
//  * budget      — the rendered block is hard-capped, and every list is bounded;
//  * dedupe      — a record never appears twice in the same list.
//
// It is pure once it has the snapshot: `fromSnapshot` does no I/O, so a turn
// reuses the single owner-scoped read the service already performs. That keeps
// ownership enforced in exactly one place (the builder in `./context`) and keeps
// the data fresh rather than a stale snapshot.

/** How much of the rendered academic block is allowed into the prompt. */
export const ACADEMIC_CONTEXT_MAX_CHARS = 3500;

const MAX_FOCUS_COURSES = 3;
const MAX_FOCUS_TASKS = 4;
const MAX_FOCUS_EVENTS = 3;
const MAX_FOCUS_NOTES = 3;
const MAX_UPCOMING_TASKS = 5;
const MAX_UPCOMING_EVENTS = 4;
const MAX_QUERY_TERMS = 12;
const MIN_TERM_LENGTH = 3;

/** A course the current question is about, expanded with its own records. */
export interface AcademicContextCourse {
  id: string;
  name: string;
  code: string | null;
  credits: number | null;
  status: string;
  openTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
  }>;
  upcomingEvents: Array<{ id: string; title: string; type: string; startAt: string }>;
  notes: Array<{ id: string; title: string }>;
  gradeSummary: { count: number; averagePercent: number | null } | null;
}

export interface AcademicContext {
  /** Point in time this context was assembled from real records. */
  generatedAt: string;
  /** The term whose date range covers "now", when the student has one. */
  currentTerm: {
    name: string;
    startDate: string;
    endDate: string;
    academicYearName: string | null;
  } | null;
  /** The courses most relevant to this question, with their linked records. */
  focus: AcademicContextCourse[];
  /** The soonest open tasks, across all courses, deduped and bounded. */
  upcomingTasks: Array<{
    id: string;
    title: string;
    courseId: string | null;
    courseCode: string | null;
    priority: string;
    dueDate: string | null;
  }>;
  /** The soonest calendar entries, across all courses, deduped and bounded. */
  upcomingEvents: Array<{
    id: string;
    title: string;
    courseId: string | null;
    courseCode: string | null;
    type: string;
    startAt: string;
  }>;
  /** How many grounded records of each kind backed this context. */
  totals: {
    courses: number;
    openTasks: number;
    upcomingEvents: number;
    notes: number;
    grades: number;
    goals: number;
    studySessions: number;
  };
  /** The record types that actually grounded this turn (provenance). */
  sources: string[];
  /** Plain statements of what could not be grounded. */
  gaps: string[];
}

/** The compact, user-safe summary a turn returns to the client (Task C). */
export interface AiContextSummary {
  sources: string[];
  gaps: string[];
  /** Total number of real records that backed the answer. */
  records: number;
}

export const academicContextBuilder = {
  /** Fetch the snapshot once, then derive the targeted context from it. */
  async build(userId: string, query?: string | null): Promise<AcademicContext> {
    const snapshot = await studentContextBuilder.build(userId);
    return this.fromSnapshot(snapshot, query);
  },

  /**
   * Derive the academic context from an already-built snapshot. Pure: no I/O,
   * so the caller keeps the single owner-scoped read it already paid for.
   */
  fromSnapshot(snapshot: StudentContext, query?: string | null): AcademicContext {
    const terms = queryTerms(query);
    const courseById = new Map(snapshot.courses.map((course) => [course.id, course]));
    const codeFor = (courseId: string | null) =>
      courseId ? courseById.get(courseId)?.code ?? null : null;

    const openTasks = snapshot.tasks;
    const hasMatch = snapshot.courses.some((course) => courseScore(course, terms) > 0);
    const focus = selectFocusCourses(snapshot, terms, hasMatch);
    const upcomingTasks = dedupeById(openTasks)
      .slice()
      .sort(byDueDateAsc)
      .slice(0, MAX_UPCOMING_TASKS)
      .map((task) => ({
        id: task.id,
        title: task.title,
        courseId: task.courseId,
        courseCode: codeFor(task.courseId),
        priority: task.priority,
        dueDate: task.dueDate,
      }));
    const upcomingEvents = dedupeById(snapshot.upcomingEvents)
      .slice()
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, MAX_UPCOMING_EVENTS)
      .map((event) => ({
        id: event.id,
        title: event.title,
        courseId: event.courseId,
        courseCode: codeFor(event.courseId),
        type: event.type,
        startAt: event.startAt,
      }));

    const totals = {
      courses: snapshot.courses.length,
      openTasks: openTasks.length,
      upcomingEvents: snapshot.upcomingEvents.length,
      notes: snapshot.recentNotes.length,
      grades: snapshot.recentGrades.length,
      goals: snapshot.activeGoals.length,
      studySessions: snapshot.recentStudySessions.length,
    };

    const sources: string[] = [];
    if (snapshot.currentSemester) sources.push("term");
    if (totals.courses > 0) sources.push("courses");
    if (totals.grades > 0) sources.push("grades");
    if (totals.openTasks > 0) sources.push("tasks");
    if (totals.upcomingEvents > 0) sources.push("events");
    if (totals.notes > 0) sources.push("notes");
    if (totals.goals > 0) sources.push("goals");
    if (totals.studySessions > 0) sources.push("study_sessions");

    return {
      generatedAt: new Date().toISOString(),
      currentTerm: snapshot.currentSemester
        ? {
            name: snapshot.currentSemester.name,
            startDate: snapshot.currentSemester.startDate,
            endDate: snapshot.currentSemester.endDate,
            academicYearName: snapshot.currentSemester.academicYearName,
          }
        : null,
      focus,
      upcomingTasks,
      upcomingEvents,
      totals,
      sources,
      gaps: gapsFor(snapshot, terms, hasMatch),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the academic context as a compact, human-readable block for the system
 * prompt. It is hard-capped, so a student with a large account still fits.
 */
export function academicContextToPromptText(context: AcademicContext): string {
  const lines: string[] = [];

  if (context.currentTerm) {
    const term = context.currentTerm;
    const year = term.academicYearName ? ` (${term.academicYearName})` : "";
    lines.push(`- Current term: ${term.name}${year}, ${day(term.startDate)} → ${day(term.endDate)}`);
  }

  if (context.focus.length > 0) {
    lines.push("- Courses most relevant to this question:");
    for (const course of context.focus) {
      const code = course.code ? `${course.code} ` : "";
      const credits = course.credits !== null ? `, ${course.credits} credits` : "";
      const grade = course.gradeSummary
        ? `, avg ${
            course.gradeSummary.averagePercent === null
              ? "n/a"
              : `${course.gradeSummary.averagePercent}%`
          } over ${course.gradeSummary.count} grade(s)`
        : "";
      lines.push(`  • ${code}${course.name} (${course.status}${credits}${grade})`);
      for (const task of course.openTasks) {
        lines.push(`    - task "${task.title}" [${task.priority}]${due(task.dueDate)}`);
      }
      for (const event of course.upcomingEvents) {
        lines.push(`    - ${event.type.toLowerCase()} "${event.title}" at ${stamp(event.startAt)}`);
      }
      for (const note of course.notes) {
        lines.push(`    - note "${note.title}"`);
      }
    }
  }

  if (context.upcomingTasks.length > 0) {
    const tasks = context.upcomingTasks
      .map((task) => `"${task.title}"${task.courseCode ? ` [${task.courseCode}]` : ""}${due(task.dueDate)} [${task.priority}]`)
      .join("; ");
    lines.push(`- Soonest open tasks: ${tasks}`);
  }

  if (context.upcomingEvents.length > 0) {
    const events = context.upcomingEvents
      .map((event) => `"${event.title}"${event.courseCode ? ` [${event.courseCode}]` : ""} (${event.type}) ${stamp(event.startAt)}`)
      .join("; ");
    lines.push(`- Soonest events: ${events}`);
  }

  lines.push(
    `- Totals: ${context.totals.courses} course(s), ${context.totals.openTasks} open task(s), ` +
      `${context.totals.upcomingEvents} event(s), ${context.totals.notes} note(s), ` +
      `${context.totals.grades} grade(s), ${context.totals.goals} goal(s), ` +
      `${context.totals.studySessions} recent study session(s)`,
  );

  if (context.gaps.length > 0) {
    lines.push(`- Gaps: ${context.gaps.join(" ")}`);
  }

  const text = lines.join("\n");
  if (text.length <= ACADEMIC_CONTEXT_MAX_CHARS) return text;
  return `${text.slice(0, ACADEMIC_CONTEXT_MAX_CHARS)}… [academic context truncated]`;
}

/** The compact, client-safe summary of what grounded the turn. */
export function summarizeAcademicContext(context: AcademicContext): AiContextSummary {
  const t = context.totals;
  return {
    sources: context.sources,
    gaps: context.gaps,
    records:
      t.courses + t.openTasks + t.upcomingEvents + t.notes + t.grades + t.goals + t.studySessions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Meaningful words from the student's own question, lowercased and deduped. */
function queryTerms(query?: string | null): string[] {
  if (!query) return [];
  const matches = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const terms: string[] = [];
  for (const term of matches) {
    if (terms.length >= MAX_QUERY_TERMS) break;
    if (term.length < MIN_TERM_LENGTH) continue;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

/** How strongly a course matches the question's words. 0 means "no signal". */
function courseScore(course: StudentContext["courses"][number], terms: string[]): number {
  if (terms.length === 0) return 0;
  const code = (course.code ?? "").toLowerCase();
  const name = course.name.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (code && (code === term || code.includes(term) || term.includes(code))) score += 6;
    if (name.includes(term)) score += 3;
  }
  return score;
}

/**
 * Pick the courses to expand. When the question names one or more courses, only
 * those are expanded (targeted); otherwise the courses with the most current
 * activity are used so the model still has an anchor. Bounded and deduped.
 */
function selectFocusCourses(
  snapshot: StudentContext,
  terms: string[],
  hasMatch: boolean,
): AcademicContextCourse[] {
  const activity = (courseId: string) =>
    snapshot.tasks.filter((task) => task.courseId === courseId).length +
    snapshot.upcomingEvents.filter((event) => event.courseId === courseId).length;

  const ranked = snapshot.courses
    .map((course) => ({ course, score: courseScore(course, terms), activity: activity(course.id) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.activity !== a.activity) return b.activity - a.activity;
      return a.course.name.localeCompare(b.course.name);
    });

  const pool = hasMatch
    ? ranked.filter((entry) => entry.score > 0)
    : ranked.filter((entry) => entry.activity > 0 || terms.length === 0);

  return pool.slice(0, MAX_FOCUS_COURSES).map((entry) => expandCourse(snapshot, entry.course));
}

function expandCourse(
  snapshot: StudentContext,
  course: StudentContext["courses"][number],
): AcademicContextCourse {
  const openTasks = snapshot.tasks
    .filter((task) => task.courseId === course.id)
    .sort(byDueDateAsc)
    .slice(0, MAX_FOCUS_TASKS)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
    }));

  const upcomingEvents = snapshot.upcomingEvents
    .filter((event) => event.courseId === course.id)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, MAX_FOCUS_EVENTS)
    .map((event) => ({ id: event.id, title: event.title, type: event.type, startAt: event.startAt }));

  const notes = snapshot.recentNotes
    .filter((note) => note.courseId === course.id)
    .slice(0, MAX_FOCUS_NOTES)
    .map((note) => ({ id: note.id, title: note.title }));

  const grades = snapshot.recentGrades.filter((grade) => grade.courseId === course.id);
  const percents = grades
    .filter((grade) => grade.score !== null && grade.maxScore)
    .map((grade) => (grade.score! / grade.maxScore!) * 100);
  const gradeSummary = grades.length
    ? {
        count: grades.length,
        averagePercent:
          percents.length > 0
            ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
            : null,
      }
    : null;

  return {
    id: course.id,
    name: course.name,
    code: course.code,
    credits: course.credits,
    status: course.status,
    openTasks,
    upcomingEvents,
    notes,
    gradeSummary,
  };
}

/** Statements about data that is missing, so the model never fills it in. */
function gapsFor(snapshot: StudentContext, terms: string[], hasMatch: boolean): string[] {
  const gaps: string[] = [];
  if (snapshot.courses.length === 0) gaps.push("No courses are on record.");
  if (!snapshot.currentSemester) gaps.push("No academic term covers today.");
  if (snapshot.tasks.length === 0) gaps.push("No open tasks are on record.");
  if (snapshot.upcomingEvents.length === 0) gaps.push("No upcoming events are on record.");
  if (snapshot.recentGrades.length === 0) gaps.push("No grades have been recorded.");
  if (snapshot.recentNotes.length === 0) gaps.push("No notes are on record.");
  if (terms.length > 0 && snapshot.courses.length > 0 && !hasMatch) {
    gaps.push("No course in the records matches the question's wording.");
  }
  return gaps;
}

function byDueDateAsc(
  a: { dueDate: string | null },
  b: { dueDate: string | null },
): number {
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function stamp(iso: string): string {
  return iso.length >= 16 ? `${day(iso)} ${iso.slice(11, 16)}` : day(iso);
}

function due(iso: string | null): string {
  return iso ? ` due ${stamp(iso)}` : " (no due date)";
}
