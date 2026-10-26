import { prisma } from "@/utils/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Proactive briefing service
// ─────────────────────────────────────────────────────────────────────────────
//
// A deterministic, read-only "what needs you now" digest for the AI workspace:
// overdue and imminently due work, upcoming exams, goals at risk, and a short
// study-week summary. Three properties matter and are pinned by tests:
//
//  * Deterministic and stateless. Plain queries over the student's own rows with
//    fixed windows — no model call (cost and rate limits), no stored briefing
//    rows, so calling it twice in a row is safe by construction and idempotent.
//  * Read-only. It never writes, never marks anything seen, never mutates
//    source records. A refresh is just another read.
//  * Owned. Every query filters `userId` first; one student's briefing can
//    never contain another's rows.
//
// There is no scheduler in this stack: the client fetches the briefing when the
// AI workspace opens (same pattern as the notification bootstrap), so nothing
// runs server-side in the background.

/** Section caps, so one noisy section cannot flood the strip. */
const OVERDUE_LIMIT = 5;
const DUE_SOON_LIMIT = 5;
const EXAM_LIMIT = 5;
const GOAL_LIMIT = 5;

/** Briefing windows, all relative to "now". */
const DUE_SOON_MS = 72 * 60 * 60 * 1000; // next 72 hours
const EXAM_WINDOW_DAYS = 14;
const GOAL_DEADLINE_DAYS = 7;
const STUDY_WINDOW_DAYS = 7;
/** An exam inside this window is urgent rather than just upcoming. */
const EXAM_URGENT_MS = 48 * 60 * 60 * 1000;

/** Open task statuses — completed/cancelled work is never briefing material. */
const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;

export type BriefingItemKind =
  | "TASK_OVERDUE"
  | "TASK_DUE_SOON"
  | "EXAM_UPCOMING"
  | "GOAL_AT_RISK"
  | "STUDY_SUMMARY";

export type BriefingSeverity = "info" | "warning" | "urgent";

export interface BriefingItem {
  /** Record id, or a stable synthetic id for computed items (the study line). */
  id: string;
  kind: BriefingItemKind;
  /** What it is — the task/exam/goal title. */
  title: string;
  /** One human line: "Overdue · due 2 days ago", "Exam · in 3 days". */
  detail: string;
  /** ISO timestamp the item hinges on, or null when there is no single date. */
  dueAt: string | null;
  /** Workspace path the client deep-links to, e.g. "/tasks". */
  link: string;
  severity: BriefingSeverity;
}

export interface BriefingSummary {
  overdueTasks: number;
  dueSoonTasks: number;
  upcomingExams: number;
  atRiskGoals: number;
  studySessionsThisWeek: number;
  studyMinutesThisWeek: number;
}

export interface ProactiveBriefing {
  generatedAt: string;
  items: BriefingItem[];
  summary: BriefingSummary;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Start of the local day `offset` days from today. */
function startOfDayOffset(offset: number, from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** "overdue by 2 days" / "due today" / "in 3 days" / "in 5 hours". */
function dueLabel(now: Date, due: Date): string {
  const deltaMs = due.getTime() - now.getTime();
  if (deltaMs < 0) {
    const days = Math.max(1, Math.ceil(-deltaMs / DAY_MS));
    return days === 1 ? "overdue by 1 day" : `overdue by ${days} days`;
  }
  if (due.toDateString() === now.toDateString()) return "due today";
  if (due.toDateString() === startOfDayOffset(1, now).toDateString()) return "due tomorrow";
  const days = Math.ceil(deltaMs / DAY_MS);
  if (days <= 1) {
    const hours = Math.max(1, Math.round(deltaMs / HOUR_MS));
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `in ${days} days`;
}

/** "in 3 days" for a future instant; "today"/"tomorrow" kept short. */
function aheadLabel(now: Date, at: Date): string {
  const deltaMs = at.getTime() - now.getTime();
  if (at.toDateString() === now.toDateString()) return "today";
  if (at.toDateString() === startOfDayOffset(1, now).toDateString()) return "tomorrow";
  const days = Math.max(1, Math.round(deltaMs / DAY_MS));
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export const proactiveService = {
  /**
   * Build the briefing for the current user. Pure reads in one round of
   * parallel queries; safe to call as often as the client likes.
   */
  async briefing(userId: string): Promise<ProactiveBriefing> {
    const now = new Date();
    const dueSoonUntil = new Date(now.getTime() + DUE_SOON_MS);
    const examUntil = addDays(now, EXAM_WINDOW_DAYS);
    const goalUntil = addDays(now, GOAL_DEADLINE_DAYS);
    const studySince = startOfDayOffset(-STUDY_WINDOW_DAYS, now);

    const [overdueTasks, dueSoonTasks, upcomingExams, atRiskGoals, recentSessions] = await Promise.all([
      prisma.task.findMany({
        where: { userId, status: { in: [...OPEN_TASK_STATUSES] }, dueDate: { lt: now } },
        orderBy: { dueDate: "asc" },
        take: OVERDUE_LIMIT,
      }),
      prisma.task.findMany({
        where: { userId, status: { in: [...OPEN_TASK_STATUSES] }, dueDate: { gte: now, lte: dueSoonUntil } },
        orderBy: { dueDate: "asc" },
        take: DUE_SOON_LIMIT,
      }),
      prisma.event.findMany({
        where: { userId, type: "EXAM", startAt: { gte: startOfDayOffset(0, now), lte: examUntil } },
        orderBy: { startAt: "asc" },
        take: EXAM_LIMIT,
      }),
      prisma.goal.findMany({
        // Past deadlines qualify too — an already-late goal is the biggest risk.
        where: { userId, status: "ACTIVE", progress: { lt: 100 }, deadline: { lte: goalUntil } },
        orderBy: { deadline: "asc" },
        take: GOAL_LIMIT,
      }),
      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: studySince } },
        select: { durationMinutes: true },
      }),
    ]);

    const items: BriefingItem[] = [];

    for (const task of overdueTasks) {
      if (!task.dueDate) continue;
      items.push({
        id: task.id,
        kind: "TASK_OVERDUE",
        title: task.title,
        detail: `Overdue · ${dueLabel(now, task.dueDate)}`,
        dueAt: task.dueDate.toISOString(),
        link: "/tasks",
        severity: "urgent",
      });
    }

    for (const task of dueSoonTasks) {
      if (!task.dueDate) continue;
      items.push({
        id: task.id,
        kind: "TASK_DUE_SOON",
        title: task.title,
        detail: `Due · ${dueLabel(now, task.dueDate)}`,
        dueAt: task.dueDate.toISOString(),
        link: "/tasks",
        severity: "warning",
      });
    }

    for (const exam of upcomingExams) {
      const urgent = exam.startAt.getTime() - now.getTime() <= EXAM_URGENT_MS;
      items.push({
        id: exam.id,
        kind: "EXAM_UPCOMING",
        title: exam.title,
        detail: `Exam · ${aheadLabel(now, exam.startAt)}`,
        dueAt: exam.startAt.toISOString(),
        link: "/calendar",
        severity: urgent ? "urgent" : "warning",
      });
    }

    for (const goal of atRiskGoals) {
      const detail = goal.deadline
        ? `Goal at ${goal.progress}% · deadline ${dueLabel(now, goal.deadline)}`
        : `Goal at ${goal.progress}%`;
      items.push({
        id: goal.id,
        kind: "GOAL_AT_RISK",
        title: goal.title,
        detail,
        dueAt: goal.deadline ? goal.deadline.toISOString() : null,
        link: "/goals",
        severity: "warning",
      });
    }

    const studyMinutesThisWeek = recentSessions.reduce(
      (total, session) => total + (session.durationMinutes ?? 0),
      0,
    );
    if (recentSessions.length > 0) {
      items.push({
        id: "study-week",
        kind: "STUDY_SUMMARY",
        title: "Study this week",
        detail: `${studyMinutesThisWeek} min across ${recentSessions.length} session${recentSessions.length === 1 ? "" : "s"} in the last 7 days`,
        dueAt: null,
        link: "/study-sessions",
        severity: "info",
      });
    }

    return {
      generatedAt: now.toISOString(),
      items,
      summary: {
        overdueTasks: overdueTasks.length,
        dueSoonTasks: dueSoonTasks.length,
        upcomingExams: upcomingExams.length,
        atRiskGoals: atRiskGoals.length,
        studySessionsThisWeek: recentSessions.length,
        studyMinutesThisWeek,
      },
    };
  },
};
