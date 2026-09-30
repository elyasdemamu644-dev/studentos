import { z } from "zod";

import { tasksService } from "@/modules/tasks/service";
import { coursesService } from "@/modules/courses/service";
import { eventsService } from "@/modules/events/service";
import { studySessionsService } from "@/modules/study-sessions/service";
import { gradesService } from "@/modules/grades/service";
import { goalsService } from "@/modules/goals/service";
import { dashboardService } from "@/modules/dashboard/service";

import type { AiToolDefinition, ProposedAction } from "./types";
import { DAY_MS, daysUntil, fail, isoDaysFromNow, ok, pct, startOfDayOffset } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE tools
// ─────────────────────────────────────────────────────────────────────────────
//
// Read-only computation over real StudentOS records. They reuse the module
// services (and the dashboard aggregate) rather than re-querying or
// re-interpreting data, so the numbers the AI reports are the same numbers the
// UI shows.
//
// `build_study_plan` is the one ANALYZE tool that returns `proposedActions`.
// It still creates nothing: it hands the agent a validated list of writes that
// become a confirmation the student must approve.

const ANALYSIS_SAMPLE_LIMIT = 100;

/** Course id → { average percent, count }, weighted by each grade's maxScore. */
function gradeStatsByCourse(grades: Array<{ courseId: string | null; score: number | null; maxScore: number | null }>) {
  const acc = new Map<string, { earned: number; possible: number; count: number }>();
  for (const grade of grades) {
    if (!grade.courseId || grade.score === null || !grade.maxScore) continue;
    const current = acc.get(grade.courseId) ?? { earned: 0, possible: 0, count: 0 };
    current.earned += grade.score;
    current.possible += grade.maxScore;
    current.count += 1;
    acc.set(grade.courseId, current);
  }
  const out = new Map<string, { averagePercent: number; count: number }>();
  for (const [courseId, s] of acc) {
    out.set(courseId, {
      averagePercent: s.possible > 0 ? Math.round((s.earned / s.possible) * 100) : 0,
      count: s.count,
    });
  }
  return out;
}

function openTaskStats(
  tasks: Array<{
    courseId: string | null;
    status: string;
    estimatedMinutes: number | null;
    dueDate: string | null;
  }>,
) {
  const acc = new Map<string, { open: number; completed: number; openMinutes: number; overdue: number }>();
  const ensure = (courseId: string) => {
    let entry = acc.get(courseId);
    if (!entry) {
      entry = { open: 0, completed: 0, openMinutes: 0, overdue: 0 };
      acc.set(courseId, entry);
    }
    return entry;
  };
  const now = new Date();
  for (const task of tasks) {
    if (!task.courseId) continue;
    const entry = ensure(task.courseId);
    if (task.status === "COMPLETED") {
      entry.completed += 1;
      continue;
    }
    if (task.status === "CANCELLED") continue;
    entry.open += 1;
    entry.openMinutes += task.estimatedMinutes ?? 0;
    if (task.dueDate && new Date(task.dueDate).getTime() < now.getTime()) entry.overdue += 1;
  }
  return acc;
}

// ── Academic progress ───────────────────────────────────────────────────────

export const analyzeAcademicProgressTool: AiToolDefinition = {
  name: "analyze_academic_progress",
  description:
    "Compute an evidence-based academic progress summary: per-course task completion and grade average, overall grade average, overdue/due-today counts, study minutes and active-goal completion. Use for 'how am I doing'.",
  kind: "ANALYZE",
  activityLabel: "Analyzing your academic progress",
  parameters: z.object({}),
  async execute(_args, ctx) {
    const [dashboard, courseList, gradeList, taskList] = await Promise.all([
      dashboardService.getDashboard(ctx.userId),
      coursesService.list(ctx.userId, { limit: 50 }),
      gradesService.list(ctx.userId, { limit: ANALYSIS_SAMPLE_LIMIT }),
      tasksService.list(ctx.userId, { limit: ANALYSIS_SAMPLE_LIMIT }),
    ]);

    const grades = gradeStatsByCourse(gradeList.items);
    const tasks = openTaskStats(taskList.items);
    const now = new Date();

    const overallEarned = gradeList.items.reduce((sum, g) => (g.score !== null && g.maxScore ? sum + g.score : sum), 0);
    const overallPossible = gradeList.items.reduce((sum, g) => (g.score !== null && g.maxScore ? sum + g.maxScore : sum), 0);

    const courses = courseList.items.map((course) => {
      const grade = grades.get(course.id);
      const task = tasks.get(course.id);
      return {
        id: course.id,
        code: course.code,
        name: course.name,
        status: course.status,
        credits: course.credits,
        gradeAveragePercent: grade?.averagePercent ?? null,
        gradeCount: grade?.count ?? 0,
        openTasks: task?.open ?? 0,
        completedTasks: task?.completed ?? 0,
        taskCompletionPercent: pct(task?.completed ?? 0, (task?.completed ?? 0) + (task?.open ?? 0)),
        openTaskMinutes: task?.openMinutes ?? 0,
        overdueTasks: task?.overdue ?? 0,
      };
    });

    return ok(
      {
        sampledTaskCount: taskList.items.length,
        sampledGradeCount: gradeList.items.length,
        overallGradeAveragePercent: overallPossible > 0 ? Math.round((overallEarned / overallPossible) * 100) : null,
        courses,
        tasks: {
          total: dashboard.tasks.total,
          byStatus: dashboard.tasks.byStatus,
          overdue: dashboard.tasks.overdue,
          dueToday: dashboard.tasks.dueToday,
        },
        study: {
          todayMinutes: dashboard.studySessions.todayMinutes,
          weekMinutes: dashboard.studySessions.weekMinutes,
        },
        goals: dashboard.activeGoals.map((g) => ({
          id: g.id,
          title: g.title,
          progress: g.progress,
          deadline: g.deadline,
          daysRemaining: daysUntil(g.deadline, now),
          milestones: `${g.milestoneCompleted}/${g.milestoneTotal} done`,
        })),
        nextExam: dashboard.exams.upcoming[0]
          ? {
              ...dashboard.exams.upcoming[0],
              daysUntil: dashboard.exams.nextInDays,
            }
          : null,
      },
      `Analysed ${courses.length} course(s) and ${gradeList.items.length} grade(s)`,
    );
  },
};

// ── Weak courses ────────────────────────────────────────────────────────────

export const identifyWeakCoursesTool: AiToolDefinition = {
  name: "identify_weak_courses",
  description:
    "Rank the student's courses by risk using real grades and open work: weighted grade average, overdue task count, open task minutes and the next exam. Returns the courses below a threshold.",
  kind: "ANALYZE",
  activityLabel: "Identifying your weakest courses",
  parameters: z.object({
    threshold: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(70)
      .describe("Grade percentage at or below which a course counts as weak. Defaults to 70."),
    minGrades: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(1)
      .describe("Minimum recorded grades before a course can be called weak on grade alone."),
    limit: z.number().int().min(1).max(20).optional().default(8),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        threshold: z.number().int().min(1).max(100).optional().default(70),
        minGrades: z.number().int().min(1).max(20).optional().default(1),
        limit: z.number().int().min(1).max(20).optional().default(8),
      })
      .parse(args);

    const now = new Date();
    const [courseList, gradeList, taskList, examList] = await Promise.all([
      coursesService.list(ctx.userId, { limit: 50 }, { status: "ACTIVE" }),
      gradesService.list(ctx.userId, { limit: ANALYSIS_SAMPLE_LIMIT }),
      tasksService.list(ctx.userId, { limit: ANALYSIS_SAMPLE_LIMIT }),
      eventsService.list(ctx.userId, {
        type: "EXAM",
        startFrom: now.toISOString(),
        limit: ANALYSIS_SAMPLE_LIMIT,
      }),
    ]);

    const grades = gradeStatsByCourse(gradeList.items);
    const tasks = openTaskStats(taskList.items);
    const nextExamByCourse = new Map<string, { title: string; startAt: string; daysUntil: number | null }>();
    for (const exam of examList.items) {
      if (exam.courseId && !nextExamByCourse.has(exam.courseId)) {
        nextExamByCourse.set(exam.courseId, {
          title: exam.title,
          startAt: exam.startAt,
          daysUntil: daysUntil(exam.startAt, now),
        });
      }
    }

    const rows = courseList.items.map((course) => {
      const grade = grades.get(course.id);
      const task = tasks.get(course.id);
      const exam = nextExamByCourse.get(course.id) ?? null;
      const weakByGrade = grade !== undefined && grade.count >= input.minGrades && grade.averagePercent <= input.threshold;
      const weakByWorkload = (task?.overdue ?? 0) > 0 || (task?.openMinutes ?? 0) > 600;
      return {
        id: course.id,
        code: course.code,
        name: course.name,
        credits: course.credits,
        gradeAveragePercent: grade?.averagePercent ?? null,
        gradeCount: grade?.count ?? 0,
        openTasks: task?.open ?? 0,
        overdueTasks: task?.overdue ?? 0,
        openTaskMinutes: task?.openMinutes ?? 0,
        nextExam: exam,
        weak: weakByGrade || weakByWorkload,
        reasons: [
          weakByGrade ? `grade average ${grade?.averagePercent}% is at or below ${input.threshold}%` : null,
          (task?.overdue ?? 0) > 0 ? `${task?.overdue} overdue task(s)` : null,
          (task?.openMinutes ?? 0) > 600 ? `${Math.round((task?.openMinutes ?? 0) / 60)}h of open work` : null,
        ].filter(Boolean) as string[],
      };
    });

    const weak = rows.filter((r) => r.weak).sort((a, b) => (a.gradeAveragePercent ?? 101) - (b.gradeAveragePercent ?? 101));

    return ok(
      {
        threshold: input.threshold,
        evaluatedCourses: rows.length,
        weakCourses: weak.slice(0, input.limit),
        allCourses: rows.slice(0, input.limit),
      },
      weak.length === 0 ? "No course is below the threshold" : `${weak.length} course(s) flagged at risk`,
    );
  },
};

// ── At-risk work ────────────────────────────────────────────────────────────

export const identifyAtRiskWorkTool: AiToolDefinition = {
  name: "identify_at_risk_work",
  description:
    "Collect everything at risk inside a time window: overdue tasks (with days late), tasks due soon, upcoming exams with a countdown, and goals that are past their deadline or not moving. Use for 'what is going to bite me'.",
  kind: "ANALYZE",
  activityLabel: "Looking for at-risk work",
  parameters: z.object({
    horizonDays: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .default(14)
      .describe("Days ahead to consider. Defaults to 14."),
  }),
  async execute(args, ctx) {
    const input = z.object({ horizonDays: z.number().int().min(1).max(60).optional().default(14) }).parse(args);
    const now = new Date();
    const horizonEnd = isoDaysFromNow(input.horizonDays);

    const [overdue, dueSoon, exams, goals] = await Promise.all([
      tasksService.list(ctx.userId, { dueBefore: now.toISOString(), limit: 20 }),
      tasksService.list(ctx.userId, {
        dueAfter: now.toISOString(),
        dueBefore: horizonEnd,
        limit: 30,
      }),
      eventsService.list(ctx.userId, {
        type: "EXAM",
        startFrom: now.toISOString(),
        startTo: horizonEnd,
        limit: 20,
      }),
      goalsService.list(ctx.userId, { status: "ACTIVE", limit: 30 }),
    ]);

    const isOpen = (t: { status: string }) => t.status === "TODO" || t.status === "IN_PROGRESS";
    const overdueItems = overdue.items.filter((t) => isOpen(t) && t.dueDate);
    const dueSoonItems = dueSoon.items.filter(isOpen);
    const stalledGoals = goals.items.filter(
      (g) => g.progress < 100 && g.deadline !== null && new Date(g.deadline).getTime() < now.getTime(),
    );

    return ok(
      {
        horizonDays: input.horizonDays,
        overdueTasks: overdueItems.map((t) => ({
          id: t.id,
          title: t.title,
          course: t.course,
          priority: t.priority,
          dueDate: t.dueDate,
          daysOverdue: daysUntil(t.dueDate, now),
        })),
        dueSoonTasks: dueSoonItems.map((t) => ({
          id: t.id,
          title: t.title,
          course: t.course,
          priority: t.priority,
          dueDate: t.dueDate,
          daysRemaining: daysUntil(t.dueDate, now),
        })),
        upcomingExams: exams.items.map((e) => ({
          id: e.id,
          title: e.title,
          course: e.course,
          startAt: e.startAt,
          daysUntil: daysUntil(e.startAt, now),
        })),
        stalledGoals: stalledGoals.map((g) => ({
          id: g.id,
          title: g.title,
          progress: g.progress,
          deadline: g.deadline,
          daysOverdue: daysUntil(g.deadline, now),
        })),
      },
      `${overdueItems.length} overdue, ${dueSoonItems.length} due soon, ${exams.items.length} exam(s) in ${input.horizonDays}d`,
    );
  },
};

// ── Study consistency ───────────────────────────────────────────────────────

export const analyzeStudyConsistencyTool: AiToolDefinition = {
  name: "analyze_study_consistency",
  description:
    "Measure study consistency over a number of weeks from real logged sessions: total minutes, session count, active days vs days in the window, a consistency percentage, the current streak, and minutes per course.",
  kind: "ANALYZE",
  activityLabel: "Analyzing your study consistency",
  parameters: z.object({
    weeks: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .default(4)
      .describe("Window length in weeks (1-8). Defaults to 4."),
  }),
  async execute(args, ctx) {
    const input = z.object({ weeks: z.number().int().min(1).max(8).optional().default(4) }).parse(args);
    const now = new Date();
    const from = new Date(now.getTime() - input.weeks * 7 * DAY_MS);

    const result = await studySessionsService.list(ctx.userId, {
      from: from.toISOString(),
      limit: ANALYSIS_SAMPLE_LIMIT,
    });

    const perDay = new Map<string, number>();
    const perCourse = new Map<string, number>();
    const durations: number[] = [];

    for (const session of result.items) {
      const minutes = session.durationMinutes ?? 0;
      durations.push(minutes);
      const day = session.startedAt.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + minutes);
      const key = session.courseId ?? "unassigned";
      perCourse.set(key, (perCourse.get(key) ?? 0) + minutes);
    }

    // Consecutive days with study time, counting back from today (or yesterday
    // if today has not been studied yet — a streak should not break at midnight).
    let streak = 0;
    for (let offset = 0; offset < input.weeks * 7 + 1; offset += 1) {
      const day = startOfDayOffset(-offset, now).toISOString().slice(0, 10);
      if ((perDay.get(day) ?? 0) > 0) {
        streak += 1;
      } else if (offset > 0) {
        break;
      }
    }

    const totalMinutes = durations.reduce((a, b) => a + b, 0);
    const daysInWindow = input.weeks * 7;

    return ok(
      {
        windowWeeks: input.weeks,
        daysInWindow,
        sessionCount: result.items.length,
        totalMinutes,
        activeDays: perDay.size,
        consistencyPercent: pct(perDay.size, daysInWindow),
        averageSessionMinutes: durations.length > 0 ? Math.round(totalMinutes / durations.length) : 0,
        longestSessionMinutes: durations.length > 0 ? Math.max(...durations) : 0,
        currentStreakDays: streak,
        minutesPerDay: [...perDay.entries()].map(([day, minutes]) => ({ day, minutes })).sort((a, b) => a.day.localeCompare(b.day)),
        minutesPerCourse: [...perCourse.entries()].map(([courseId, minutes]) => ({ courseId, minutes })),
        sampled: result.hasMore,
      },
      `${perDay.size} active day(s) of ${daysInWindow}, ${totalMinutes} min studied`,
    );
  },
};

// ── Workload ────────────────────────────────────────────────────────────────

export const calculateWorkloadTool: AiToolDefinition = {
  name: "calculate_workload",
  description:
    "Calculate the committed workload in a window: number of open tasks due, total estimated minutes, per-day distribution, how much of it has no estimate, study minutes already logged, and how many events fall in the window.",
  kind: "ANALYZE",
  activityLabel: "Calculating your workload",
  parameters: z.object({
    horizonDays: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .default(7)
      .describe("Window length in days. Defaults to 7."),
  }),
  async execute(args, ctx) {
    const input = z.object({ horizonDays: z.number().int().min(1).max(30).optional().default(7) }).parse(args);
    const now = new Date();
    const end = isoDaysFromNow(input.horizonDays);

    const [tasks, sessions, events] = await Promise.all([
      tasksService.list(ctx.userId, { dueAfter: now.toISOString(), dueBefore: end, limit: ANALYSIS_SAMPLE_LIMIT }),
      studySessionsService.list(ctx.userId, { from: now.toISOString(), to: end, limit: ANALYSIS_SAMPLE_LIMIT }),
      eventsService.list(ctx.userId, { startFrom: now.toISOString(), startTo: end, limit: ANALYSIS_SAMPLE_LIMIT }),
    ]);

    const open = tasks.items.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    const perDay = new Map<string, { tasks: number; minutes: number }>();
    let estimatedMinutes = 0;
    let withoutEstimate = 0;

    for (const task of open) {
      if (!task.dueDate) continue;
      const day = task.dueDate.slice(0, 10);
      const entry = perDay.get(day) ?? { tasks: 0, minutes: 0 };
      entry.tasks += 1;
      entry.minutes += task.estimatedMinutes ?? 0;
      perDay.set(day, entry);
      if (task.estimatedMinutes === null) withoutEstimate += 1;
      else estimatedMinutes += task.estimatedMinutes;
    }

    return ok(
      {
        windowDays: input.horizonDays,
        openTaskCount: open.length,
        estimatedMinutes,
        estimatedHours: Math.round((estimatedMinutes / 60) * 10) / 10,
        tasksWithoutEstimate: withoutEstimate,
        studyMinutesLogged: sessions.summary.totalMinutes,
        studySessionCount: sessions.summary.count,
        eventCount: events.items.length,
        perDay: [...perDay.entries()]
          .map(([day, v]) => ({ day, ...v }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        sampledTasks: tasks.hasMore,
      },
      `${open.length} open task(s), ~${Math.round(estimatedMinutes / 60)}h estimated in ${input.horizonDays}d`,
    );
  },
};

// ── Priorities ──────────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = { URGENT: 30, HIGH: 20, MEDIUM: 10, LOW: 0 };

export const identifyUpcomingPrioritiesTool: AiToolDefinition = {
  name: "identify_upcoming_priorities",
  description:
    "Rank open tasks by real urgency: overdue days, days until due, task priority, estimated effort and whether the task's course has an exam inside the window. Returns the top items with the reason for each.",
  kind: "ANALYZE",
  activityLabel: "Ranking your upcoming priorities",
  parameters: z.object({
    horizonDays: z.number().int().min(1).max(60).optional().default(7),
    limit: z.number().int().min(1).max(20).optional().default(8),
  }),
  async execute(args, ctx) {
    const input = z
      .object({
        horizonDays: z.number().int().min(1).max(60).optional().default(7),
        limit: z.number().int().min(1).max(20).optional().default(8),
      })
      .parse(args);

    const now = new Date();
    const [tasks, exams] = await Promise.all([
      tasksService.list(ctx.userId, { dueBefore: isoDaysFromNow(input.horizonDays), limit: ANALYSIS_SAMPLE_LIMIT }),
      eventsService.list(ctx.userId, {
        type: "EXAM",
        startFrom: now.toISOString(),
        startTo: isoDaysFromNow(input.horizonDays),
        limit: 50,
      }),
    ]);

    const examCourseIds = new Set(exams.items.map((e) => e.courseId).filter((id): id is string => Boolean(id)));

    const open = tasks.items.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    const ranked = open
      .map((task) => {
        const remaining = daysUntil(task.dueDate, now);
        const overdueDays = remaining !== null && remaining < 0 ? -remaining : 0;
        let score = PRIORITY_WEIGHT[task.priority] ?? 0;
        score += Math.max(0, 20 - (remaining ?? 20) * 2);
        score += overdueDays * 8;
        if (task.courseId && examCourseIds.has(task.courseId)) score += 25;
        if (task.estimatedMinutes && task.estimatedMinutes > 180) score += 5;

        const reasons: string[] = [];
        if (overdueDays > 0) reasons.push(`overdue by ${overdueDays} day(s)`);
        else if (remaining !== null) reasons.push(`due in ${remaining} day(s)`);
        else reasons.push("no due date");
        if (task.priority === "URGENT" || task.priority === "HIGH") reasons.push(`${task.priority.toLowerCase()} priority`);
        if (task.courseId && examCourseIds.has(task.courseId)) reasons.push("course has an exam in this window");

        return { id: task.id, title: task.title, course: task.course, dueDate: task.dueDate, priority: task.priority, estimatedMinutes: task.estimatedMinutes, score, reasons };
      })
      .sort((a, b) => b.score - a.score);

    return ok(
      {
        windowDays: input.horizonDays,
        considered: open.length,
        priorities: ranked.slice(0, input.limit),
      },
      `Ranked ${Math.min(ranked.length, input.limit)} priority task(s) from ${open.length} open`,
    );
  },
};

// ── Study plan ──────────────────────────────────────────────────────────────

/** Rotating focus labels so a multi-day plan does not look copy-pasted. */
const PLAN_FOCUSES = [
  "concept review",
  "past-paper practice",
  "weak-topic drill",
  "summary + active recall",
  "mock questions",
  "flashcard review",
  "office-hour questions",
];

const buildStudyPlanArgs = z.object({
  courseId: z.string().min(1).optional().describe("Course to plan for. Use get_courses or get_upcoming_exams first."),
  courseName: z.string().min(1).max(200).optional().describe("Course name or code, used to resolve the course."),
  examEventId: z.string().min(1).optional().describe("Id of the EXAM calendar entry to plan around."),
  days: z.number().int().min(1).max(30).optional().default(7).describe("Number of days to plan. Defaults to 7."),
  sessionsPerDay: z.number().int().min(1).max(4).optional().default(1),
  minutesPerSession: z.number().int().min(15).max(240).optional().default(45),
  includeTasks: z.boolean().optional().default(true).describe("Also propose revision tasks alongside the sessions."),
  focus: z.string().max(300).optional().describe("Free-text study focus, e.g. 'normalisation and indexing'."),
});

export const buildStudyPlanTool: AiToolDefinition = {
  name: "build_study_plan",
  description:
    "Build a day-by-day study plan for a course or an upcoming exam from real StudentOS data. It only *proposes* sessions and tasks — the student is asked to confirm before anything is created. Always confirm the target course with the student first.",
  kind: "ANALYZE",
  activityLabel: "Preparing a study plan",
  parameters: buildStudyPlanArgs,
  async execute(args, ctx) {
    const input = buildStudyPlanArgs.parse(args);
    const now = new Date();

    // ── Resolve the course the plan is for ──────────────────────────────────
    let course: { id: string; name: string; code: string | null } | null = null;
    let exam: { id: string; title: string; startAt: string; daysUntil: number | null } | null = null;

    if (input.examEventId) {
      const event = await eventsService.getById(ctx.userId, input.examEventId);
      exam = { id: event.id, title: event.title, startAt: event.startAt, daysUntil: daysUntil(event.startAt, now) };
      if (event.courseId) {
        const found = await coursesService.getById(ctx.userId, event.courseId);
        course = { id: found.id, name: found.name, code: found.code };
      }
    }

    if (!course && input.courseId) {
      const found = await coursesService.getById(ctx.userId, input.courseId);
      course = { id: found.id, name: found.name, code: found.code };
    }

    if (!course && input.courseName) {
      const found = await coursesService.list(ctx.userId, { limit: 50 }, { search: input.courseName });
      const needle = input.courseName.toLowerCase();
      const match =
        found.items.find((c) => c.name.toLowerCase() === needle) ??
        found.items.find((c) => c.code?.toLowerCase() === needle) ??
        found.items.find((c) => c.name.toLowerCase().includes(needle));
      if (match) course = { id: match.id, name: match.name, code: match.code };
      else {
        return fail(
          "course_not_found",
          `No course matches "${input.courseName}". Call get_courses and ask the student which one they mean.`,
        );
      }
    }

    if (!course) {
      // Fall back to the soonest upcoming exam, then to a single active course.
      const upcomingExams = await eventsService.list(ctx.userId, {
        type: "EXAM",
        startFrom: now.toISOString(),
        limit: 5,
      });
      const next = upcomingExams.items.find((e) => e.courseId);
      if (next?.courseId) {
        const found = await coursesService.getById(ctx.userId, next.courseId);
        course = { id: found.id, name: found.name, code: found.code };
        exam = { id: next.id, title: next.title, startAt: next.startAt, daysUntil: daysUntil(next.startAt, now) };
      } else {
        const active = await coursesService.list(ctx.userId, { limit: 50 }, { status: "ACTIVE" });
        if (active.items.length === 1) {
          course = { id: active.items[0].id, name: active.items[0].name, code: active.items[0].code };
        } else if (active.items.length === 0) {
          return fail("no_courses", "This student has no active courses, so no study plan can be built.");
        } else {
          return fail(
            "ambiguous_course",
            "Several active courses exist and no exam was specified. Call get_courses and ask the student which course the plan is for.",
            { candidates: active.items.slice(0, 10).map((c) => ({ id: c.id, code: c.code, name: c.name })) },
          );
        }
      }
    }

    if (!course) return fail("course_not_found", "Could not resolve a course for the study plan.");

    // ── Shape the window around the exam ─────────────────────────────────────
    const daysUntilExam = exam ? daysUntil(exam.startAt, now) : null;
    const days = daysUntilExam !== null && daysUntilExam > 0 ? Math.min(input.days, daysUntilExam) : input.days;
    const subject = input.focus ? `${course.name} — ${input.focus}` : course.name;

    const startDay = startOfDayOffset(1, now);
    const schedule: Array<{ day: number; date: string; sessions: Array<{ topic: string; startedAt: string; endedAt: string; durationMinutes: number }> }> = [];
    const proposedActions: ProposedAction[] = [];

    for (let day = 1; day <= days; day += 1) {
      const dayDate = startOfDayOffset(day, now);
      const sessions: Array<{ topic: string; startedAt: string; endedAt: string; durationMinutes: number }> = [];

      for (let slot = 0; slot < input.sessionsPerDay; slot += 1) {
        const start = new Date(dayDate);
        start.setHours(17 + slot * 2, 0, 0, 0); // 17:00, 19:00, …
        const end = new Date(start.getTime() + input.minutesPerSession * 60 * 1000);
        const focusLabel = PLAN_FOCUSES[(day - 1 + slot) % PLAN_FOCUSES.length];
        const topic = `${subject}: ${focusLabel} (day ${day})`;

        sessions.push({
          topic,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          durationMinutes: input.minutesPerSession,
        });

        proposedActions.push({
          tool: "create_study_session",
          description: `Study session on ${start.toISOString().slice(0, 10)} at ${String(start.getHours()).padStart(2, "0")}:00 — ${focusLabel} (${input.minutesPerSession} min)`,
          arguments: {
            courseId: course.id,
            topic,
            startedAt: start.toISOString(),
            endedAt: end.toISOString(),
            durationMinutes: input.minutesPerSession,
          },
        });
      }

      schedule.push({ day, date: dayDate.toISOString().slice(0, 10), sessions });
    }

    // ── A few revision tasks alongside the sessions ──────────────────────────
    const taskTitles = [
      `Summarise ${subject} — key concepts`,
      `Complete ${course.code ?? course.name} practice problems`,
      `Self-test on ${subject} without notes`,
    ];
    const taskDays = [1, Math.max(1, Math.ceil(days / 2)), Math.max(1, days)];

    if (input.includeTasks) {
      taskTitles.slice(0, Math.max(1, Math.min(3, days))).forEach((title, index) => {
        const due = startOfDayOffset(taskDays[index], now);
        due.setHours(21, 0, 0, 0);
        proposedActions.push({
          tool: "create_task",
          description: `Task due ${due.toISOString().slice(0, 10)} — ${title}`,
          arguments: {
            title,
            courseId: course.id,
            type: "REVISION",
            priority: "HIGH",
            dueDate: due.toISOString(),
            estimatedMinutes: input.minutesPerSession,
          },
        });
      });
    }

    const sessionCount = schedule.reduce((sum, d) => sum + d.sessions.length, 0);
    const taskCount = proposedActions.length - sessionCount;

    return {
      ok: true,
      summary: `${course.name} plan: ${sessionCount} study session(s) and ${taskCount} task(s) from ${schedule[0]?.date ?? ""} to ${schedule[schedule.length - 1]?.date ?? ""}`,
      data: {
        course,
        exam,
        window: {
          from: schedule[0]?.date ?? null,
          to: schedule[schedule.length - 1]?.date ?? null,
          days,
          sessionsPerDay: input.sessionsPerDay,
          minutesPerSession: input.minutesPerSession,
        },
        sessionCount,
        taskCount,
        schedule,
      },
      proposedActions,
    };
  },
};

export const analyzeTools: AiToolDefinition[] = [
  analyzeAcademicProgressTool,
  identifyWeakCoursesTool,
  identifyAtRiskWorkTool,
  analyzeStudyConsistencyTool,
  calculateWorkloadTool,
  identifyUpcomingPrioritiesTool,
  buildStudyPlanTool,
];
