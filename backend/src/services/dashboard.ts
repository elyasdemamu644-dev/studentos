import { prisma } from "@/utils/prisma";

export type DashboardCourse = {
  id: string;
  code: string | null;
  name: string;
  status: string;
  taskTotal: number;
  taskCompleted: number;
  /** 0-100, null when the course has no tasks yet. */
  taskProgress: number | null;
  /** 0-100 weighted/simple average of scored grades, null when none scored. */
  gradeAverage: number | null;
  gradeCount: number;
};

export type DashboardResponse = {
  academicYears: Array<{ id: string; name: string; startDate: string; endDate: string; status: string }>;
  currentAcademicYear: { id: string; name: string; startDate: string; endDate: string; status: string } | null;
  currentSemester: { id: string; name: string; academicYearId: string; startDate: string; endDate: string; status: string } | null;
  courses: {
    total: number;
    active: number;
    completed: number;
    recent: DashboardCourse[];
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    dueToday: number;
  };
  upcomingTasks: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    priority: string;
    status: string;
    course: { id: string; code: string | null; name: string } | null;
  }>;
  overdueTasks: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    priority: string;
    status: string;
    course: { id: string; code: string | null; name: string } | null;
  }>;
  exams: {
    /** Exams (Event rows of type EXAM) starting in the future, soonest first. */
    upcoming: Array<{
      id: string;
      title: string;
      startAt: string;
      endAt: string | null;
      location: string | null;
      course: { id: string; code: string | null; name: string } | null;
    }>;
    nextInDays: number | null;
  };
  events: {
    today: Array<{
      id: string;
      title: string;
      type: string;
      startAt: string;
      endAt: string;
      location: string | null;
      course: { id: string; code: string | null; name: string } | null;
    }>;
    upcoming: Array<{
      id: string;
      title: string;
      type: string;
      startAt: string;
      endAt: string;
      location: string | null;
      course: { id: string; code: string | null; name: string } | null;
    }>;
  };
  studySessions: {
    todayMinutes: number;
    todayCount: number;
    weekMinutes: number;
    recent: Array<{ id: string; topic: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null }>;
  };
  activeGoals: Array<{
    id: string;
    title: string;
    progress: number;
    deadline: string | null;
    status: string;
    milestoneTotal: number;
    milestoneCompleted: number;
  }>;
  recentNotes: Array<{ id: string; title: string; updatedAt: string; course: { id: string; code: string | null; name: string } | null }>;
  recentGrades: Array<{
    id: string;
    title: string;
    score: number | null;
    maxScore: number | null;
    type: string;
    recordedAt: string;
    course: { id: string; code: string | null; name: string } | null;
  }>;
  resources: { total: number };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      message: string;
      type: string;
      status: string;
      relatedType: string | null;
      relatedId: string | null;
      createdAt: string;
    }>;
  };
  /** Cross-system recent activity, newest first. */
  activity: Array<{
    id: string;
    kind: "task" | "note" | "grade" | "event" | "goal" | "resource";
    title: string;
    detail: string | null;
    at: string;
    href: string | null;
  }>;
};

type CourseRef = { id: string; code: string | null; name: string } | null;

const DAY_MS = 24 * 60 * 60 * 1000;

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Picks the semester the student is actually in: an explicit ACTIVE one, else
 * the one whose date range contains today, else the next one to start, else the
 * most recent past one. Ordering alone is not enough — a user with a completed
 * and an upcoming semester would otherwise always land on the oldest.
 */
function resolveCurrentSemester<
  T extends { id: string; academicYearId: string; startDate: Date; endDate: Date; status: string },
>(semesters: T[], now: Date): T | null {
  if (semesters.length === 0) return null;

  const active = semesters.find((s) => s.status === "ACTIVE");
  if (active) return active;

  const containing = semesters.find((s) => s.startDate <= now && s.endDate >= now);
  if (containing) return containing;

  const upcoming = semesters
    .filter((s) => s.startDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  if (upcoming.length > 0) return upcoming[0];

  const past = semesters
    .filter((s) => s.endDate < now)
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  return past[0] ?? null;
}

export const dashboardService = {
  async getDashboard(userId: string): Promise<DashboardResponse> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const courseRef = { select: { id: true, code: true, name: true } } as const;

    // Only the six courses the dashboard actually renders. Every course-scoped
    // query below is bounded to them, so a student with years of history never
    // makes the command center load their whole academic record to show a
    // summary. Totals come from a groupBy, not from materialising every row.
    const recentCourses = await prisma.course.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, code: true, name: true, status: true },
    });
    const recentCourseIds = recentCourses.map((c) => c.id);

    const [
      academicYears,
      semesters,
      courseStatusGroups,
      taskStatusGroups,
      taskPriorityGroups,
      courseTaskGroups,
      overdueCount,
      dueTodayCount,
      overdueTasks,
      upcomingTasks,
      todayEvents,
      upcomingEvents,
      upcomingExams,
      todaySessions,
      weekSessions,
      recentSessions,
      activeGoals,
      recentNotes,
      recentGrades,
      courseGrades,
      resourceTotal,
      unreadNotifications,
      recentNotifications,
      activityTasks,
      activityNotes,
      activityGrades,
      activityEvents,
      activityGoals,
      activityResources,
    ] = await Promise.all([
      prisma.academicYear.findMany({
        where: { userId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      }),
      prisma.semester.findMany({
        where: { userId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, academicYearId: true, startDate: true, endDate: true, status: true },
      }),
      prisma.course.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["priority"],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["courseId", "status"],
        where: { userId, courseId: { not: null } },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: startOfToday } },
      }),
      prisma.task.count({
        where: {
          userId,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
      prisma.task.findMany({
        where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: startOfToday } },
        orderBy: { dueDate: "asc" },
        take: 8,
        select: { id: true, title: true, dueDate: true, priority: true, status: true, course: courseRef },
      }),
      prisma.task.findMany({
        where: { userId, status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { gte: startOfToday } },
        orderBy: { dueDate: "asc" },
        take: 8,
        select: { id: true, title: true, dueDate: true, priority: true, status: true, course: courseRef },
      }),
      prisma.event.findMany({
        where: { userId, startAt: { gte: startOfToday, lt: startOfTomorrow } },
        orderBy: { startAt: "asc" },
        take: 8,
        select: { id: true, title: true, type: true, startAt: true, endAt: true, location: true, course: courseRef },
      }),
      prisma.event.findMany({
        where: { userId, startAt: { gte: startOfTomorrow } },
        orderBy: { startAt: "asc" },
        take: 6,
        select: { id: true, title: true, type: true, startAt: true, endAt: true, location: true, course: courseRef },
      }),
      prisma.event.findMany({
        where: { userId, type: "EXAM", startAt: { gte: now } },
        orderBy: { startAt: "asc" },
        take: 5,
        select: { id: true, title: true, startAt: true, endAt: true, location: true, course: courseRef },
      }),
      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: startOfToday, lt: startOfTomorrow } },
        select: { durationMinutes: true },
      }),
      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: startOfWeek, lt: startOfTomorrow } },
        select: { durationMinutes: true },
      }),
      prisma.studySession.findMany({
        where: { userId },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { id: true, topic: true, startedAt: true, endedAt: true, durationMinutes: true },
      }),
      prisma.goal.findMany({
        where: { userId, status: "ACTIVE" },
        orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 6,
        select: {
          id: true,
          title: true,
          progress: true,
          deadline: true,
          status: true,
          milestones: { select: { status: true } },
        },
      }),
      prisma.note.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, updatedAt: true, course: courseRef },
      }),
      prisma.grade.findMany({
        where: { userId },
        orderBy: { recordedAt: "desc" },
        take: 5,
        select: { id: true, title: true, score: true, maxScore: true, type: true, recordedAt: true, course: courseRef },
      }),
      prisma.grade.findMany({
        where: {
          userId,
          courseId: { in: recentCourseIds },
          score: { not: null },
          maxScore: { gt: 0 },
        },
        select: { courseId: true, score: true, maxScore: true, weight: true },
      }),
      prisma.resource.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, status: "UNREAD" } }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          status: true,
          relatedType: true,
          relatedId: true,
          createdAt: true,
        },
      }),
      prisma.task.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 4,
        select: { id: true, title: true, status: true, updatedAt: true },
      }),
      prisma.note.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, title: true, updatedAt: true },
      }),
      prisma.grade.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.event.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true, type: true, createdAt: true },
      }),
      prisma.goal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.resource.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, title: true, resourceType: true, createdAt: true },
      }),
    ]);

    // ── Tasks ──────────────────────────────────────────────
    const byStatus: Record<string, number> = {};
    let taskTotal = 0;
    for (const group of taskStatusGroups) {
      byStatus[group.status] = group._count._all;
      taskTotal += group._count._all;
    }

    const byPriority: Record<string, number> = {};
    for (const group of taskPriorityGroups) {
      byPriority[group.priority] = group._count._all;
    }

    // ── Course aggregates ──────────────────────────────────
    const tasksByCourse = new Map<string, { total: number; completed: number }>();
    for (const group of courseTaskGroups) {
      if (!group.courseId) continue;
      const entry = tasksByCourse.get(group.courseId) ?? { total: 0, completed: 0 };
      entry.total += group._count._all;
      if (group.status === "COMPLETED") entry.completed += group._count._all;
      tasksByCourse.set(group.courseId, entry);
    }

    let coursesTotal = 0;
    let coursesActive = 0;
    let coursesCompleted = 0;
    for (const group of courseStatusGroups) {
      coursesTotal += group._count._all;
      if (group.status === "ACTIVE") coursesActive += group._count._all;
      if (group.status === "COMPLETED") coursesCompleted += group._count._all;
    }

    // Weighted average when weights are present, otherwise a plain mean.
    const gradeSums = new Map<string, { weighted: number; weightTotal: number; plain: number; count: number }>();
    for (const g of courseGrades) {
      if (!g.courseId || g.score === null || g.maxScore === null || g.maxScore <= 0) continue;
      const ratio = (g.score / g.maxScore) * 100;
      const entry = gradeSums.get(g.courseId) ?? { weighted: 0, weightTotal: 0, plain: 0, count: 0 };
      entry.plain += ratio;
      entry.count += 1;
      if (g.weight !== null && g.weight > 0) {
        entry.weighted += ratio * g.weight;
        entry.weightTotal += g.weight;
      }
      gradeSums.set(g.courseId, entry);
    }

    const courseProgress: DashboardCourse[] = recentCourses.map((c) => {
      const t = tasksByCourse.get(c.id) ?? { total: 0, completed: 0 };
      const g = gradeSums.get(c.id);
      const gradeAverage = g
        ? g.weightTotal > 0
          ? Math.round(g.weighted / g.weightTotal)
          : Math.round(g.plain / g.count)
        : null;
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        status: c.status,
        taskTotal: t.total,
        taskCompleted: t.completed,
        taskProgress: pct(t.completed, t.total),
        gradeAverage,
        gradeCount: g?.count ?? 0,
      };
    });

    const mapTask = (t: (typeof upcomingTasks)[number]) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      priority: t.priority,
      status: t.status,
      course: t.course as CourseRef,
    });

    // ── Academics ──────────────────────────────────────────
    const currentSemester = resolveCurrentSemester(semesters, now);
    const currentAcademicYear = currentSemester
      ? academicYears.find((y) => y.id === currentSemester.academicYearId) ?? null
      : academicYears[0] ?? null;

    const nextExam = upcomingExams[0] ?? null;

    const activity: DashboardResponse["activity"] = [
      ...activityTasks.map((t) => ({
        id: `task-${t.id}`,
        kind: "task" as const,
        title: t.title,
        detail: t.status === "COMPLETED" ? "Task completed" : `Task ${t.status.toLowerCase().replace("_", " ")}`,
        at: t.updatedAt.toISOString(),
        href: "/tasks",
      })),
      ...activityNotes.map((n) => ({
        id: `note-${n.id}`,
        kind: "note" as const,
        title: n.title,
        detail: "Note updated",
        at: n.updatedAt.toISOString(),
        href: `/notes?note=${n.id}`,
      })),
      ...activityGrades.map((g) => ({
        id: `grade-${g.id}`,
        kind: "grade" as const,
        title: g.title,
        detail: "Grade recorded",
        at: g.createdAt.toISOString(),
        href: "/analytics",
      })),
      ...activityEvents.map((e) => ({
        id: `event-${e.id}`,
        kind: "event" as const,
        title: e.title,
        detail: `${e.type.toLowerCase()} event added`,
        at: e.createdAt.toISOString(),
        href: "/calendar",
      })),
      ...activityGoals.map((g) => ({
        id: `goal-${g.id}`,
        kind: "goal" as const,
        title: g.title,
        detail: "Goal created",
        at: g.createdAt.toISOString(),
        href: "/goals",
      })),
      ...activityResources.map((r) => ({
        id: `resource-${r.id}`,
        kind: "resource" as const,
        title: r.title,
        detail: `${r.resourceType.toLowerCase()} resource added`,
        at: r.createdAt.toISOString(),
        href: "/resources",
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);

    const mapEventRow = (e: (typeof todayEvents)[number]) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      startAt: e.startAt.toISOString(),
      endAt: (e.endAt ?? e.startAt).toISOString(),
      location: e.location,
      course: e.course as CourseRef,
    });

    return {
      academicYears: academicYears.map((y) => ({
        id: y.id,
        name: y.name,
        startDate: y.startDate.toISOString(),
        endDate: y.endDate.toISOString(),
        status: y.status,
      })),
      currentAcademicYear: currentAcademicYear
        ? {
            id: currentAcademicYear.id,
            name: currentAcademicYear.name,
            startDate: currentAcademicYear.startDate.toISOString(),
            endDate: currentAcademicYear.endDate.toISOString(),
            status: currentAcademicYear.status,
          }
        : null,
      currentSemester: currentSemester
        ? {
            id: currentSemester.id,
            name: currentSemester.name,
            academicYearId: currentSemester.academicYearId,
            startDate: currentSemester.startDate.toISOString(),
            endDate: currentSemester.endDate.toISOString(),
            status: currentSemester.status,
          }
        : null,
      courses: {
        total: coursesTotal,
        active: coursesActive,
        completed: coursesCompleted,
        recent: courseProgress,
      },
      tasks: {
        total: taskTotal,
        byStatus,
        byPriority,
        overdue: overdueCount,
        dueToday: dueTodayCount,
      },
      upcomingTasks: upcomingTasks.map(mapTask),
      overdueTasks: overdueTasks.map(mapTask),
      exams: {
        upcoming: upcomingExams.map((e) => ({
          id: e.id,
          title: e.title,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt ? e.endAt.toISOString() : null,
          location: e.location,
          course: e.course as CourseRef,
        })),
        nextInDays: nextExam
          ? Math.max(0, Math.ceil((nextExam.startAt.getTime() - now.getTime()) / DAY_MS))
          : null,
      },
      events: {
        today: todayEvents.map(mapEventRow),
        upcoming: upcomingEvents.map(mapEventRow),
      },
      studySessions: {
        todayMinutes: todaySessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
        todayCount: todaySessions.length,
        weekMinutes: weekSessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
        recent: recentSessions.map((s) => ({
          id: s.id,
          topic: s.topic,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          durationMinutes: s.durationMinutes,
        })),
      },
      activeGoals: activeGoals.map((g) => ({
        id: g.id,
        title: g.title,
        progress: g.progress,
        deadline: g.deadline ? g.deadline.toISOString() : null,
        status: g.status,
        milestoneTotal: g.milestones.length,
        milestoneCompleted: g.milestones.filter((m) => m.status === "COMPLETED").length,
      })),
      recentNotes: recentNotes.map((n) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt.toISOString(),
        course: n.course as CourseRef,
      })),
      recentGrades: recentGrades.map((g) => ({
        id: g.id,
        title: g.title,
        score: g.score,
        maxScore: g.maxScore,
        type: g.type,
        recordedAt: g.recordedAt.toISOString(),
        course: g.course as CourseRef,
      })),
      resources: { total: resourceTotal },
      notifications: {
        unreadCount: unreadNotifications,
        recent: recentNotifications.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          status: n.status,
          relatedType: n.relatedType,
          relatedId: n.relatedId,
          createdAt: n.createdAt.toISOString(),
        })),
      },
      activity,
    };
  },
};
