import { prisma } from "@/utils/prisma";
import { NotFoundError, ValidationApiError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { StudySessionListQuery, StudySessionCreate } from "../schemas/study-sessions";
import type { UpdateStudySessionInput } from "../schemas/study-sessions";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

function rangeWindow(range?: string, from?: string, to?: string): { gte?: Date; lte?: Date } {
  const now = new Date();
  let gte: Date | undefined;
  let lte: Date | undefined;

  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      gte = start;
      break;
    }
    case "week": {
      gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    }
    case "month": {
      gte = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
  }
  if (from) gte = new Date(from);
  if (to) lte = new Date(to);

  return { gte, lte };
}

export const studySessionsService = {
  /**
   * List study sessions for the current user, with optional course/date
   * filters. Returns sessions newest-first plus a summary of total study
   * time across the filtered set.
   */
  async list(userId: string, query: StudySessionListQuery) {
    const { courseId, taskId, range, from, to, limit = 50, cursor } = query;

    const where: Prisma.StudySessionWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (taskId) where.taskId = taskId;

    const window = rangeWindow(range, from, to);
    if (window.gte || window.lte) {
      where.startedAt = {
        ...(window.gte ? { gte: window.gte } : {}),
        ...(window.lte ? { lte: window.lte } : {}),
      };
    }

    const [records, summary] = await Promise.all([
      prisma.studySession.findMany({
        where,
        include: {
          course: { select: { id: true, code: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.studySession.aggregate({
        where,
        _count: { id: true },
        _sum: { durationMinutes: true },
      }),
    ]);

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapStudySession),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      summary: {
        count: summary._count.id,
        totalMinutes: summary._sum.durationMinutes ?? 0,
      },
    };
  },

  /** Get a single study session by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const session = await prisma.studySession.findFirst({
      where: { id, userId },
      include: { course: { select: { id: true, code: true, name: true } } },
    });
    if (!session) throw new NotFoundError("Study session not found");
    return mapStudySession(session);
  },

  /** Create a study session. Duration is computed when start/end are known. */
  async create(userId: string, input: StudySessionCreate) {
    await assertOwnsRelations(userId, input.courseId, input.taskId);

    const startedAt = new Date(input.startedAt);
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (endedAt && endedAt.getTime() < startedAt.getTime()) {
      throw new ValidationApiError("endedAt must be on or after startedAt");
    }

    const duration =
      input.durationMinutes ??
      computeDuration(startedAt, endedAt);

    const session = await prisma.studySession.create({
      data: {
        userId,
        courseId: input.courseId ?? null,
        taskId: input.taskId ?? null,
        topic: input.topic ?? null,
        startedAt,
        endedAt,
        durationMinutes: duration,
        focusRating: input.focusRating ?? null,
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapStudySession(session);
  },

  /** Update a study session (partial). */
  async update(userId: string, id: string, input: UpdateStudySessionInput) {
    const existing = await prisma.studySession.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Study session not found");

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      await assertOwnsRelations(userId, input.courseId, null);
    }
    if (input.taskId !== undefined && input.taskId !== existing.taskId) {
      await assertOwnsRelations(userId, null, input.taskId);
    }

    const nextStartedAt = input.startedAt ? new Date(input.startedAt) : existing.startedAt;
    const nextEndedAt =
      input.endedAt !== undefined
        ? input.endedAt
          ? new Date(input.endedAt)
          : null
        : existing.endedAt;
    if (nextEndedAt && nextEndedAt.getTime() < nextStartedAt.getTime()) {
      throw new ValidationApiError("endedAt must be on or after startedAt");
    }

    const duration =
      input.durationMinutes ??
      computeDuration(nextStartedAt, nextEndedAt);

    const session = await prisma.studySession.update({
      where: { id },
      data: {
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
        ...(input.taskId !== undefined && { taskId: input.taskId ?? null }),
        ...(input.topic !== undefined && { topic: input.topic }),
        ...(input.startedAt !== undefined && { startedAt: nextStartedAt }),
        ...(input.endedAt !== undefined && { endedAt: nextEndedAt }),
        ...(duration !== null && { durationMinutes: duration }),
        ...(input.focusRating !== undefined && { focusRating: input.focusRating }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapStudySession(session);
  },

  /**
   * Complete a study session: sets endedAt (defaults to now) and computes
   * the actual duration when it wasn't provided.
   */
  async complete(
    userId: string,
    id: string,
    input: { endedAt?: Date | null; durationMinutes?: number | null; focusRating?: number | null },
  ) {
    const existing = await prisma.studySession.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Study session not found");

    const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
    if (endedAt.getTime() < existing.startedAt.getTime()) {
      throw new ValidationApiError("endedAt must be on or after startedAt");
    }

    const duration =
      input.durationMinutes ??
      computeDuration(existing.startedAt, endedAt);

    const session = await prisma.studySession.update({
      where: { id },
      data: {
        endedAt,
        durationMinutes: duration,
        ...(input.focusRating !== undefined && { focusRating: input.focusRating }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapStudySession(session);
  },

  /** Delete a study session. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.studySession.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Study session not found");

    await prisma.studySession.delete({ where: { id } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertOwnsRelations(
  userId: string,
  courseId?: string | null,
  taskId?: string | null,
): Promise<void> {
  if (courseId) {
    const course = await prisma.course.findFirst({ where: { id: courseId, userId } });
    if (!course) throw new NotFoundError("Course not found");
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
    if (!task) throw new NotFoundError("Task not found");
  }
}

function computeDuration(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms < 0) return null;
  return Math.round(ms / 60000);
}

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapStudySession(record: {
  id: string;
  courseId: string | null;
  taskId: string | null;
  topic: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number | null;
  focusRating: number | null;
  createdAt: Date;
  course: { id: string; code: string | null; name: string } | null;
}) {
  return {
    id: record.id,
    courseId: record.courseId,
    taskId: record.taskId,
    topic: record.topic,
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt ? record.endedAt.toISOString() : null,
    durationMinutes: record.durationMinutes,
    focusRating: record.focusRating,
    createdAt: record.createdAt.toISOString(),
    course: record.course ?? null,
  };
}