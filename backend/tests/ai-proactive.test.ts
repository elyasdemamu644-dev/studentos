import { describe, it, expect, beforeAll } from "vitest";

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { tasksService } from "@/services/tasks";
import { eventsService } from "@/services/events";
import { goalsService } from "@/services/goals";
import { studySessionsService } from "@/services/study-sessions";

// ─────────────────────────────────────────────────────────────────────────────
// The proactive briefing: a deterministic "what needs you now" digest for the
// AI workspace. Three properties are pinned here, because they are what make
// it safe to call on every page open with no scheduler behind it:
//
//  * Fixed windows around now — overdue/open work, 72 hours of due-soon work,
//    14 days of exams (urgent inside 48 hours), goals whose deadline is inside
//    7 days or already passed, and a 7-day study summary.
//  * Owned — every item belongs to the requesting student.
//  * Read-only — repeated calls return the same items and write nothing.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/api/v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString();
}

let empty: { token: string };
let alice: { token: string; id: string };
let bob: { token: string; id: string };

beforeAll(async () => {
  const e = await registerAndLogin("briefing-empty@test.com", "Pass123!");
  const a = await registerAndLogin("briefing-alice@test.com", "Pass123!");
  const b = await registerAndLogin("briefing-bob@test.com", "Pass123!");
  empty = { token: e.token };
  alice = { token: a.token, id: a.user.id };
  bob = { token: b.token, id: b.user.id };

  // ── Alice: one record in and just outside every section ──────────────────
  await tasksService.create(alice.id, {
    title: "Overdue essay",
    type: "HOMEWORK",
    priority: "HIGH",
    status: "TODO",
    dueDate: iso(-2),
  });
  await tasksService.create(alice.id, {
    title: "Due soon problem set",
    type: "HOMEWORK",
    priority: "MEDIUM",
    status: "IN_PROGRESS",
    dueDate: iso(1),
  });
  // Excluded: completed work is never briefing material, however late it was.
  await tasksService.create(alice.id, {
    title: "Finished already",
    type: "OTHER",
    priority: "LOW",
    status: "COMPLETED",
    dueDate: iso(-3),
  });
  // Excluded: beyond the 72-hour due-soon window.
  await tasksService.create(alice.id, {
    title: "Due in ten days",
    type: "OTHER",
    priority: "LOW",
    status: "TODO",
    dueDate: iso(10),
  });

  // Exams: one urgent (inside 48h), one upcoming, two excluded by type/window.
  await eventsService.create(alice.id, { title: "Midterm in thirty hours", type: "EXAM", startAt: iso(1.25) });
  await eventsService.create(alice.id, { title: "Final in five days", type: "EXAM", startAt: iso(5) });
  await eventsService.create(alice.id, { title: "Monday lecture", type: "CLASS", startAt: iso(1) });
  await eventsService.create(alice.id, { title: "Exam next month", type: "EXAM", startAt: iso(30) });

  // Goals: one at risk (deadline inside 7 days), two excluded.
  await goalsService.create(alice.id, { title: "Learn SQL properly", deadline: iso(3) });
  await goalsService.create(alice.id, { title: "Learn Rust someday", deadline: iso(30) });
  const done = await goalsService.create(alice.id, { title: "Shipped the app", deadline: iso(2) });
  await authRequestJson("patch", `${BASE}/goals/${done.id}`, alice.token, { status: "COMPLETED" });

  // Study week: two sessions inside the window (75 minutes), one outside.
  await studySessionsService.create(alice.id, { topic: "Algorithms", startedAt: iso(-1), durationMinutes: 30 });
  await studySessionsService.create(alice.id, { topic: "Databases", startedAt: iso(-2), durationMinutes: 45 });
  await studySessionsService.create(alice.id, { topic: "Long ago", startedAt: iso(-20), durationMinutes: 20 });

  // ── Bob: his own two tasks, to prove the sections stay per-student ───────
  await tasksService.create(bob.id, {
    title: "Bob's overdue lab",
    type: "ASSIGNMENT",
    priority: "HIGH",
    status: "TODO",
    dueDate: iso(-1),
  });
  await tasksService.create(bob.id, {
    title: "Bob's imminent homework",
    type: "HOMEWORK",
    priority: "MEDIUM",
    status: "TODO",
    dueDate: iso(0.5),
  });
});

describe("GET /ai/proactive/briefing", () => {
  it("returns an empty briefing for an account with nothing due", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, empty.token);
    expect(res.status).toBe(200);

    const { generatedAt, items, summary } = res.body.data;
    expect(new Date(generatedAt).toString()).not.toBe("Invalid Date");
    expect(items).toEqual([]);
    expect(summary).toEqual({
      overdueTasks: 0,
      dueSoonTasks: 0,
      upcomingExams: 0,
      atRiskGoals: 0,
      studySessionsThisWeek: 0,
      studyMinutesThisWeek: 0,
    });
  });

  it("reports each window for the student's own records", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, alice.token);
    expect(res.status).toBe(200);

    const { items, summary } = res.body.data;
    expect(summary).toEqual({
      overdueTasks: 1,
      dueSoonTasks: 1,
      upcomingExams: 2,
      atRiskGoals: 1,
      studySessionsThisWeek: 2,
      studyMinutesThisWeek: 75,
    });

    const byKind = (kind: string) => items.filter((item: { kind: string }) => item.kind === kind);

    const overdue = byKind("TASK_OVERDUE");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ title: "Overdue essay", severity: "urgent", link: "/tasks" });
    expect(overdue[0].detail).toMatch(/^Overdue · /);
    expect(overdue[0].dueAt).toBeTruthy();

    const dueSoon = byKind("TASK_DUE_SOON");
    expect(dueSoon).toHaveLength(1);
    expect(dueSoon[0]).toMatchObject({ title: "Due soon problem set", severity: "warning", link: "/tasks" });

    const exams = byKind("EXAM_UPCOMING");
    expect(exams).toHaveLength(2);
    const urgent = exams.find((e: { title: string }) => e.title === "Midterm in thirty hours");
    const upcoming = exams.find((e: { title: string }) => e.title === "Final in five days");
    expect(urgent.severity).toBe("urgent");
    expect(upcoming.severity).toBe("warning");
    expect(exams.every((e: { link: string }) => e.link === "/calendar")).toBe(true);

    const goals = byKind("GOAL_AT_RISK");
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ title: "Learn SQL properly", severity: "warning", link: "/goals" });
    expect(goals[0].detail).toContain("deadline");

    const study = byKind("STUDY_SUMMARY");
    expect(study).toHaveLength(1);
    expect(study[0]).toMatchObject({ id: "study-week", severity: "info", dueAt: null, link: "/study-sessions" });
    expect(study[0].detail).toBe("75 min across 2 sessions in the last 7 days");
  });

  it("excludes completed work, far-off dates and non-exam events", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, alice.token);
    const titles = res.body.data.items.map((item: { title: string }) => item.title);

    expect(titles).not.toContain("Finished already");
    expect(titles).not.toContain("Due in ten days");
    expect(titles).not.toContain("Monday lecture");
    expect(titles).not.toContain("Exam next month");
    expect(titles).not.toContain("Learn Rust someday");
    expect(titles).not.toContain("Shipped the app");
  });

  it("never mixes two students' records", async () => {
    const a = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, alice.token);
    const b = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, bob.token);

    const aTitles = a.body.data.items.map((item: { title: string }) => item.title);
    const bTitles = b.body.data.items.map((item: { title: string }) => item.title);

    expect(aTitles).not.toContain("Bob's overdue lab");
    expect(bTitles).not.toContain("Overdue essay");
    expect(bTitles).toContain("Bob's overdue lab");
    expect(bTitles).toContain("Bob's imminent homework");

    expect(b.body.data.summary).toEqual({
      overdueTasks: 1,
      dueSoonTasks: 1,
      upcomingExams: 0,
      atRiskGoals: 0,
      studySessionsThisWeek: 0,
      studyMinutesThisWeek: 0,
    });
  });

  it("is read-only and repeatable: same items, nothing written", async () => {
    const countsBefore = {
      tasks: await prisma.task.count(),
      goals: await prisma.goal.count(),
      events: await prisma.event.count(),
      sessions: await prisma.studySession.count(),
      notifications: await prisma.notification.count(),
      memories: await prisma.aiMemory.count(),
    };

    const first = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, alice.token);
    const second = await authRequestJson("get", `${BASE}/ai/proactive/briefing`, alice.token);

    expect(second.status).toBe(200);
    expect(second.body.data.items.map((item: { id: string }) => item.id)).toEqual(
      first.body.data.items.map((item: { id: string }) => item.id),
    );
    expect(second.body.data.summary).toEqual(first.body.data.summary);

    const countsAfter = {
      tasks: await prisma.task.count(),
      goals: await prisma.goal.count(),
      events: await prisma.event.count(),
      sessions: await prisma.studySession.count(),
      notifications: await prisma.notification.count(),
      memories: await prisma.aiMemory.count(),
    };
    expect(countsAfter).toEqual(countsBefore);
  });
});
