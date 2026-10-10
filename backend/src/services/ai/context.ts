import { prisma } from "@/utils/prisma";

// ─────────────────────────────────────────────
// Student Context Builder
// ─────────────────────────────────────────────
//
// Assembles a compact, curated summary of a student's StudentOS data and
// serializes it to JSON. This is fed to the AI provider as system context so
// answers are grounded in the user's real courses/tasks/events/etc. It never
// dumps the whole database — only bounded, relevant slices.

export interface StudentContext {
  /** The semester whose date range covers "now", if the student has one. */
  currentSemester: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    academicYearName: string | null;
  } | null;
  courses: Array<{
    id: string;
    name: string;
    code: string | null;
    status: string;
    semesterId: string | null;
    credits: number | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    courseId: string | null;
    status: string;
    priority: string;
    dueDate: string | null;
    estimatedMinutes: number | null;
  }>;
  upcomingEvents: Array<{
    id: string;
    title: string;
    courseId: string | null;
    type: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
  }>;
  recentStudySessions: Array<{
    id: string;
    topic: string | null;
    courseId: string | null;
    durationMinutes: number | null;
  }>;
  activeGoals: Array<{ id: string; title: string; progress: number; deadline: string | null }>;
  recentNotes: Array<{ id: string; title: string; courseId: string | null }>;
  recentGrades: Array<{
    id: string;
    title: string;
    courseId: string | null;
    score: number | null;
    maxScore: number | null;
    weight: number | null;
  }>;
}

export const studentContextBuilder = {
  /** Build a bounded context summary for the given user. */
  async build(userId: string): Promise<StudentContext> {
    const now = new Date();

    const [currentSemester, courses, tasks, events, studySessions, goals, notes, grades] =
      await Promise.all([
        prisma.semester.findFirst({
          where: { userId, startDate: { lte: now }, endDate: { gte: now } },
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            academicYear: { select: { name: true } },
          },
          orderBy: { startDate: "desc" },
        }),
        prisma.course.findMany({
          where: { userId },
          take: 30,
          select: { id: true, name: true, code: true, status: true, semesterId: true, credits: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.task.findMany({
          where: { userId, status: { not: "COMPLETED" } },
          take: 30,
          select: {
            id: true,
            title: true,
            courseId: true,
            status: true,
            priority: true,
            dueDate: true,
            estimatedMinutes: true,
          },
          orderBy: { dueDate: "asc" },
        }),
        prisma.event.findMany({
          where: { userId, startAt: { gte: now } },
          take: 20,
          select: {
            id: true,
            title: true,
            courseId: true,
            type: true,
            startAt: true,
            endAt: true,
            location: true,
          },
          orderBy: { startAt: "asc" },
        }),
        prisma.studySession.findMany({
          where: { userId },
          take: 10,
          select: { id: true, topic: true, courseId: true, durationMinutes: true },
          orderBy: { startedAt: "desc" },
        }),
        prisma.goal.findMany({
          where: { userId, status: "ACTIVE" },
          take: 20,
          select: { id: true, title: true, progress: true, deadline: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.note.findMany({
          where: { userId },
          take: 10,
          select: { id: true, title: true, courseId: true },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.grade.findMany({
          where: { userId },
          take: 20,
          select: { id: true, title: true, courseId: true, score: true, maxScore: true, weight: true },
          orderBy: { recordedAt: "desc" },
        }),
      ]);

    return {
      currentSemester: currentSemester
        ? {
            id: currentSemester.id,
            name: currentSemester.name,
            startDate: currentSemester.startDate.toISOString(),
            endDate: currentSemester.endDate.toISOString(),
            academicYearName: currentSemester.academicYear?.name ?? null,
          }
        : null,
      courses,
      tasks: tasks.map((t) => ({
        ...t,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      })),
      upcomingEvents: events.map((e) => ({
        ...e,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
      })),
      recentStudySessions: studySessions,
      activeGoals: goals.map((g) => ({
        ...g,
        deadline: g.deadline ? g.deadline.toISOString() : null,
      })),
      recentNotes: notes,
      recentGrades: grades,
    };
  },

  /** Serialize the context for use as a system prompt. */
  async toPrompt(userId: string): Promise<string> {
    const context = await this.build(userId);
    return JSON.stringify({ studentos: context });
  },
};