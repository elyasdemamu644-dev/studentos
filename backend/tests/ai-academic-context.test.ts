import { describe, expect, it } from "vitest";

import { prisma, registerAndLogin } from "./helpers";
import { academicContextBuilder, academicContextToPromptText, summarizeAcademicContext, ACADEMIC_CONTEXT_MAX_CHARS } from "@/services/ai/academic-context";
import type { StudentContext } from "@/services/ai/context";

/**
 * The unified academic context layer is what turns the broad snapshot into a
 * *targeted* view: it ranks the courses the question is about, expands them with
 * the records that reference them, records provenance, and states its gaps. These
 * tests pin those properties — plus owner-scoping and freshness — so a future
 * change cannot quietly drop one of them.
 */

function snapshot(overrides: Partial<StudentContext> = {}): StudentContext {
  return {
    currentSemester: null,
    courses: [],
    tasks: [],
    upcomingEvents: [],
    recentStudySessions: [],
    activeGoals: [],
    recentNotes: [],
    recentGrades: [],
    ...overrides,
  };
}

const NOW = new Date("2026-10-18T09:00:00.000Z");

describe("academicContextBuilder.fromSnapshot: relevance and relationships", () => {
  it("focuses the course named in the question and links its own records", () => {
    const context = academicContextBuilder.fromSnapshot(
      snapshot({
        currentSemester: {
          id: "sem-1",
          name: "Fall 2026",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-12-20T00:00:00.000Z",
          academicYearName: "2026/27",
        },
        courses: [
          { id: "c-db", name: "Databases", code: "CS204", status: "ACTIVE", semesterId: "sem-1", credits: 5 },
          { id: "c-alg", name: "Algebra", code: "MA101", status: "ACTIVE", semesterId: "sem-1", credits: 4 },
        ],
        tasks: [
          { id: "t-db", title: "ER diagram", courseId: "c-db", status: "TODO", priority: "HIGH", dueDate: "2026-10-20T09:00:00.000Z", estimatedMinutes: 90 },
          { id: "t-alg", title: "Problem set 3", courseId: "c-alg", status: "TODO", priority: "LOW", dueDate: "2026-10-19T09:00:00.000Z", estimatedMinutes: 60 },
        ],
        upcomingEvents: [
          { id: "e-db", title: "CS204 Final", courseId: "c-db", type: "EXAM", startAt: "2026-11-14T09:00:00.000Z", endAt: null, location: null },
        ],
        recentNotes: [{ id: "n-db", title: "Normalisation", courseId: "c-db" }],
        recentGrades: [{ id: "g-db", title: "Midterm", courseId: "c-db", score: 40, maxScore: 50, weight: 30 }],
      }),
      "When is my CS204 exam?",
    );

    expect(context.focus[0]).toMatchObject({ id: "c-db", code: "CS204" });
    expect(context.focus[0]!.openTasks.map((t) => t.id)).toEqual(["t-db"]);
    expect(context.focus[0]!.upcomingEvents.map((e) => e.id)).toEqual(["e-db"]);
    expect(context.focus[0]!.notes.map((n) => n.id)).toEqual(["n-db"]);
    expect(context.focus[0]!.gradeSummary).toEqual({ count: 1, averagePercent: 80 });
    // Only the matching course is expanded; the unrelated one is not.
    expect(context.focus.map((c) => c.id)).not.toContain("c-alg");
  });

  it("records provenance for the record types that actually grounded it", () => {
    const context = academicContextBuilder.fromSnapshot(
      snapshot({
        courses: [{ id: "c1", name: "Databases", code: "CS204", status: "ACTIVE", semesterId: null, credits: 5 }],
        tasks: [{ id: "t1", title: "ER diagram", courseId: "c1", status: "TODO", priority: "HIGH", dueDate: null, estimatedMinutes: null }],
      }),
      "CS204",
    );

    expect(context.sources).toContain("courses");
    expect(context.sources).toContain("tasks");
    expect(context.sources).not.toContain("grades");
    expect(context.totals.courses).toBe(1);
    expect(context.totals.openTasks).toBe(1);
  });

  it("dedupes a record listed twice", () => {
    const task = { id: "t1", title: "ER diagram", courseId: null, status: "TODO", priority: "HIGH", dueDate: null, estimatedMinutes: null };
    const context = academicContextBuilder.fromSnapshot(snapshot({ tasks: [task, { ...task }] }));
    expect(context.upcomingTasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("states its gaps plainly when there is nothing to ground on", () => {
    const context = academicContextBuilder.fromSnapshot(snapshot(), "When is my CS204 exam?");
    expect(context.gaps.join(" ")).toMatch(/no courses are on record/i);
    expect(context.gaps.join(" ")).toMatch(/no academic term covers today/i);
    expect(context.sources).toEqual([]);
  });

  it("reports a gap when the question names a course that is not on record", () => {
    const context = academicContextBuilder.fromSnapshot(
      snapshot({
        courses: [{ id: "c1", name: "Algebra", code: "MA101", status: "ACTIVE", semesterId: null, credits: 4 }],
      }),
      "When is my CS204 exam?",
    );
    expect(context.gaps.join(" ")).toMatch(/no course .* matches/i);
  });

  it("hard-caps the rendered block so a large account still fits the prompt", () => {
    const courses = Array.from({ length: 200 }, (_, i) => ({
      id: `c-${i}`,
      name: `A very long course name number ${i} with extra words`,
      code: `CODE${i}`,
      status: "ACTIVE",
      semesterId: null,
      credits: 3,
    }));
    const context = academicContextBuilder.fromSnapshot(snapshot({ courses }));
    const text = academicContextToPromptText(context);
    expect(text.length).toBeLessThanOrEqual(ACADEMIC_CONTEXT_MAX_CHARS + "… [academic context truncated]".length);
  });
});

describe("summarizeAcademicContext", () => {
  it("counts the real records that grounded the turn", () => {
    const context = academicContextBuilder.fromSnapshot(
      snapshot({
        courses: [{ id: "c1", name: "Databases", code: "CS204", status: "ACTIVE", semesterId: null, credits: 5 }],
        tasks: [{ id: "t1", title: "ER diagram", courseId: "c1", status: "TODO", priority: "HIGH", dueDate: null, estimatedMinutes: null }],
        recentGrades: [{ id: "g1", title: "Midterm", courseId: "c1", score: 40, maxScore: 50, weight: 30 }],
      }),
    );
    expect(summarizeAcademicContext(context)).toMatchObject({ records: 3 });
  });
});

describe("academicContextBuilder.build: ownership and freshness", () => {
  async function seedStudent(tag: string) {
    const auth = await registerAndLogin(`${tag}@ai-academic-context.test`, "Pass123!");
    const userId = auth.user.id;
    const course = await prisma.course.create({
      data: { userId, name: "Databases", code: "CS204", status: "ACTIVE", credits: 5 },
    });
    return { userId, courseId: course.id };
  }

  it("never leaks another student's records into the context", async () => {
    const owner = await seedStudent("ac-owner");
    const other = await seedStudent("ac-intruder");
    await prisma.task.create({
      data: { userId: other.userId, courseId: other.courseId, title: "Secret task", status: "TODO", priority: "LOW", dueDate: NOW },
    });

    const context = await academicContextBuilder.build(owner.userId, "what is due");

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(other.courseId);
    expect(serialized).not.toContain("Secret task");
  });

  it("reflects a record added after a previous build (fresh, not a stale snapshot)", async () => {
    const { userId, courseId } = await seedStudent("ac-fresh");

    const first = await academicContextBuilder.build(userId, "CS204");
    expect(first.totals.openTasks).toBe(0);

    await prisma.task.create({
      data: { userId, courseId, title: "New assignment", status: "TODO", priority: "HIGH", dueDate: NOW },
    });

    const second = await academicContextBuilder.build(userId, "CS204");
    expect(second.totals.openTasks).toBe(1);
    expect(second.upcomingTasks.map((t) => t.title)).toContain("New assignment");
  });
});
