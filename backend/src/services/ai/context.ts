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
  courses: Array<{ id: string; name: string; code: string | null; status: string }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: string | null }>;
  upcomingEvents: Array<{ id: string; title: string; type: string; startAt: string }>;
  recentStudySessions: Array<{ id: string; topic: string | null; durationMinutes: number | null }>;
  activeGoals: Array<{ id: string; title: string; progress: number; deadline: string | null }>;
  recentNotes: Array<{ id: string; title: string }>;
  recentGrades: Array<{ id: string; title: string; score: number | null; maxScore: number | null }>;
}

export const studentContextBuilder = {
  /** Build a bounded context summary for the given user. */
  async build(userId: string): Promise<StudentContext> {
    const now = new Date();

    const [courses, tasks, events, studySessions, goals, notes, grades] =
      await Promise.all([
        prisma.course.findMany({
          where: { userId },
          take: 30,
          select: { id: true, name: true, code: true, status: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.task.findMany({
          where: { userId, status: { not: "COMPLETED" } },
          take: 30,
          select: { id: true, title: true, status: true, priority: true, dueDate: true },
          orderBy: { dueDate: "asc" },
        }),
        prisma.event.findMany({
          where: { userId, startAt: { gte: now } },
          take: 20,
          select: { id: true, title: true, type: true, startAt: true },
          orderBy: { startAt: "asc" },
        }),
        prisma.studySession.findMany({
          where: { userId },
          take: 10,
          select: { id: true, topic: true, durationMinutes: true },
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
          select: { id: true, title: true },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.grade.findMany({
          where: { userId },
          take: 20,
          select: { id: true, title: true, score: true, maxScore: true },
          orderBy: { recordedAt: "desc" },
        }),
      ]);

    return {
      courses,
      tasks: tasks.map((t) => ({
        ...t,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      })),
      upcomingEvents: events.map((e) => ({
        ...e,
        startAt: e.startAt.toISOString(),
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