import { prisma } from "@/lib/prisma";

export type DashboardResponse = {
  academicYears: Array<{ id: string; name: string; startDate: string; endDate: string; status: string }>;
  currentAcademicYear: { id: string; name: string; startDate: string; endDate: string; status: string } | null;
  currentSemester: { id: string; name: string; academicYearId: string; startDate: string; endDate: string; status: string } | null;
  courses: { total: number; active: number; recent: Array<{ id: string; code: string; name: string }> };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  upcomingTasks: Array<{ id: string; title: string; dueDate: string | null; priority: string; status: string }>;
  // Phase 2 additions
  events: {
    today: Array<{ id: string; title: string; type: string; startAt: string; endAt: string }>;
    upcoming: Array<{ id: string; title: string; type: string; startAt: string; endAt: string }>;
  };
  studySessions: {
    todayMinutes: number;
    todayCount: number;
    recent: Array<{ id: string; topic: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null }>;
  };
  activeGoals: Array<{ id: string; title: string; progress: number; deadline: string | null; status: string }>;
  recentNotes: Array<{ id: string; title: string; updatedAt: string }>;
  recentGrades: Array<{ id: string; title: string; score: number | null; maxScore: number | null; recordedAt: string }>;
  notifications: { unreadCount: number };
};

// A task "counts" toward dashboard stats only when it is tied to a course,
// and a course counts only when it owns at least one task. This keeps the
// dashboard totals consistent across a full hierarchy vs. a partial one.
export const dashboardService = {
  async getDashboard(userId: string): Promise<DashboardResponse> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [
      academicYears,
      semesters,
      countedTasks,
      taskCourses,
      dueTasks,
      todayEvents,
      upcomingEvents,
      todaySessions,
      recentSessions,
      activeGoals,
      recentNotes,
      recentGrades,
      unreadNotifications,
    ] = await Promise.all([
      prisma.academicYear.findMany({
        where: { userId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      }),
      prisma.semester.findMany({
        where: { userId },
        orderBy: { startDate: "asc" },
        select: { id: true, name: true, academicYearId: true, startDate: true, endDate: true, status: true },
      }),
      prisma.task.findMany({
        where: { userId, courseId: { not: null } },
        select: { status: true, priority: true },
      }),
      prisma.course.findMany({
        where: { userId, tasks: { some: {} } },
        select: { id: true, code: true, name: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.task.findMany({
        where: { userId, dueDate: { not: null }, status: { not: "COMPLETED" } },
        orderBy: { dueDate: "asc" },
        take: 10,
        select: { id: true, title: true, dueDate: true, priority: true, status: true },
      }),
      prisma.event.findMany({
        where: { userId, startAt: { gte: startOfToday, lt: startOfTomorrow } },
        orderBy: { startAt: "asc" },
        select: { id: true, title: true, type: true, startAt: true, endAt: true },
      }),
      prisma.event.findMany({
        where: { userId, startAt: { gte: startOfTomorrow } },
        orderBy: { startAt: "asc" },
        take: 6,
        select: { id: true, title: true, type: true, startAt: true, endAt: true },
      }),
      prisma.studySession.findMany({
        where: { userId, startedAt: { gte: startOfToday, lt: startOfTomorrow } },
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
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, progress: true, deadline: true, status: true },
      }),
      prisma.note.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, updatedAt: true },
      }),
      prisma.grade.findMany({
        where: { userId },
        orderBy: { recordedAt: "desc" },
        take: 5,
        select: { id: true, title: true, score: true, maxScore: true, recordedAt: true },
      }),
      prisma.notification.count({ where: { userId, status: "UNREAD" } }),
    ]);

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const t of countedTasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    }
    if (countedTasks.length > 0) byStatus.DELETED = byStatus.DELETED ?? 0;

    const currentSemester = semesters[0] ?? null;

    let currentAcademicYear: DashboardResponse["currentAcademicYear"] = null;
    if (currentSemester) {
      const year = academicYears.find((y) => y.id === currentSemester.academicYearId) ?? null;
      if (year) {
        currentAcademicYear = {
          id: year.id,
          name: year.name,
          startDate: year.startDate.toISOString(),
          endDate: year.endDate.toISOString(),
          status: year.status,
        };
      }
    }
    if (!currentAcademicYear && academicYears.length > 0) {
      const first = academicYears[0];
      currentAcademicYear = {
        id: first.id,
        name: first.name,
        startDate: first.startDate.toISOString(),
        endDate: first.endDate.toISOString(),
        status: first.status,
      };
    }

    return {
      academicYears: academicYears.map((y) => ({
        id: y.id,
        name: y.name,
        startDate: y.startDate.toISOString(),
        endDate: y.endDate.toISOString(),
        status: y.status,
      })),
      currentAcademicYear,
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
        total: taskCourses.length,
        active: taskCourses.filter((c) => c.status === "ACTIVE").length,
        recent: taskCourses.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      },
      tasks: {
        total: countedTasks.length,
        byStatus,
        byPriority,
      },
      upcomingTasks: dueTasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate?.toISOString() ?? null,
        priority: t.priority,
        status: t.status,
      })),
      events: {
        today: todayEvents.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt ? e.endAt.toISOString() : e.startAt.toISOString(),
        })),
        upcoming: upcomingEvents.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt ? e.endAt.toISOString() : e.startAt.toISOString(),
        })),
      },
      studySessions: {
        todayMinutes: todaySessions.reduce(
          (sum, s) => sum + (s.durationMinutes ?? 0),
          0,
        ),
        todayCount: todaySessions.length,
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
      })),
      recentNotes: recentNotes.map((n) => ({
        id: n.id,
        title: n.title,
        updatedAt: n.updatedAt.toISOString(),
      })),
      recentGrades: recentGrades.map((g) => ({
        id: g.id,
        title: g.title,
        score: g.score,
        maxScore: g.maxScore,
        recordedAt: g.recordedAt.toISOString(),
      })),
      notifications: { unreadCount: unreadNotifications },
    };
  },
};