import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  NotFoundError,
} from "@/config/errors";
import type {
  CourseCreate,
  CourseUpdate,
} from "@/modules/courses/schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const coursesService = {
  /** List courses visible to the current user.
   *
   * By default returns courses owned by the requesting user.
   * Paginated; pass `limit`/`cursor` for large sets.
   * Optional filters: `semesterId`, `status`, `search`.
   */
  async list(
    userId: string,
    options: { limit?: number; cursor?: string },
    query?: {
      semesterId?: string;
      status?: string;
      search?: string;
    },
  ) {
    const { limit = 50, cursor } = options;

    const where: Record<string, unknown> = { userId };

    if (query?.semesterId) {
      where.semesterId = query.semesterId;
    }

    if (query?.status) {
      where.status = query.status;
    }

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search } },
        { code: { contains: query.search } },
      ];
    }

    const records = await prisma.course.findMany({
      where,
      include: {
        semester: {
          include: { academicYear: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapCourse),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single course by id, scoped to the current user. */
  async getById(userId: string, id: string) {
    const course = await prisma.course.findFirst({
      where: { id, userId },
      include: {
        semester: {
          include: { academicYear: true },
        },
      },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    return mapCourse(course);
  },

  /** Create a new course.
   *
   * Validates:
   *  - the semester belongs to an academic year owned by the user
   *  - the code is unique within the semester
   */
  async create(userId: string, input: CourseCreate) {
    if (input.semesterId) {
      const semester = await prisma.semester.findFirst({
        where: {
          id: input.semesterId,
          academicYear: { userId },
        },
      });

      if (!semester) {
        throw new NotFoundError("Semester not found");
      }
    }

    const course = await prisma.course.create({
      data: {
        userId,
        code: input.code?.toUpperCase() ?? null,
        name: input.name,
        credits: input.credits ?? null,
        description: input.description ?? null,
        instructor: input.instructor ?? null,
        semesterId: input.semesterId ?? null,
        status: "ACTIVE",
      },
      include: {
        semester: {
          include: { academicYear: true },
        },
      },
    });

    return mapCourse(course);
  },

  /** Update a course (partial update).
   *
   * Only provided fields are changed.
   * Validates ownership and semester chain when semester is changed.
   */
  async update(userId: string, id: string, input: CourseUpdate) {
    const existing = await prisma.course.findFirst({
      where: { id, userId },
      include: {
        semester: {
          include: { academicYear: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError("Course not found");
    }

    // If semester is being changed, validate the new chain
    if (input.semesterId !== undefined && input.semesterId !== existing.semesterId) {
      const semester = await prisma.semester.findFirst({
        where: {
          id: input.semesterId,
          academicYear: { userId },
        },
      });

      if (!semester) {
        throw new NotFoundError("Semester not found");
      }
    }

    const updated = await prisma.course.update({
      where: { id },
      data: {
        ...(input.code !== undefined && {
          code: input.code.toUpperCase(),
        }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.credits !== undefined && { credits: input.credits }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.instructor !== undefined && {
          instructor: input.instructor,
        }),
        ...(input.semesterId !== undefined && {
          semesterId: input.semesterId,
        }),
        ...(input.status !== undefined && { status: input.status }),
      },
      include: {
        semester: {
          include: { academicYear: true },
        },
      },
    });

    return mapCourse(updated);
  },

  /** Delete a course.
   *
   * Only the owner can delete, and only if the course has no
   * dependent data (tasks, notes, etc.).
   */
  async delete(userId: string, id: string) {
    const existing = await prisma.course.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Course not found");
    }

    try {
      await prisma.course.delete({
        where: { id },
      });
    } catch (error) {
      // Prisma error code P2025 = record to delete does not exist
      // (already deleted or foreign key violation)
      if (error instanceof Error && "code" in error) {
        const e = error as { code?: string };
        if (e.code === "P2025") {
          throw new ConflictError(
            "Cannot delete a course that has associated data",
          );
        }
      }
      throw error;
    }

    return { deleted: true };
  },

  /**
   * Cross-system rollup for one course: how the course is tracking across
   * tasks, events (incl. exams), notes, resources, grades and study time.
   *
   * This is what makes the systems work together — the course page and the
   * dashboard read progress from here instead of each recomputing it.
   */
  async getSummary(userId: string, id: string) {
    const course = await prisma.course.findFirst({
      where: { id, userId },
      select: { id: true, name: true, code: true, status: true, credits: true, semesterId: true },
    });
    if (!course) throw new NotFoundError("Course not found");

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [
      taskGroups,
      openTaskCount,
      overdueCount,
      upcomingEvents,
      examCount,
      nextExam,
      noteCount,
      resourceCount,
      grades,
      studyAgg,
      goalCount,
      todayEventCount,
    ] = await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: { userId, courseId: id },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: { userId, courseId: id, status: { in: ["TODO", "IN_PROGRESS"] } },
      }),
      prisma.task.count({
        where: {
          userId,
          courseId: id,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { lt: now },
        },
      }),
      prisma.event.findMany({
        where: { userId, courseId: id, startAt: { gte: now } },
        orderBy: { startAt: "asc" },
        take: 5,
        select: { id: true, title: true, type: true, startAt: true, endAt: true, location: true },
      }),
      prisma.event.count({ where: { userId, courseId: id, type: "EXAM" } }),
      prisma.event.findFirst({
        where: { userId, courseId: id, type: "EXAM", startAt: { gte: now } },
        orderBy: { startAt: "asc" },
        select: { id: true, title: true, startAt: true, location: true },
      }),
      prisma.note.count({ where: { userId, courseId: id } }),
      prisma.resource.count({ where: { userId, courseId: id } }),
      prisma.grade.findMany({
        where: { userId, courseId: id },
        orderBy: { recordedAt: "desc" },
        select: {
          id: true,
          title: true,
          score: true,
          maxScore: true,
          weight: true,
          type: true,
          recordedAt: true,
        },
      }),
      prisma.studySession.aggregate({
        where: { userId, courseId: id },
        _sum: { durationMinutes: true },
        _count: { _all: true },
      }),
      // Goals are user-level, so "related" goals are surfaced by title match
      // against this course's code or name.
      prisma.goal.count({
        where: {
          userId,
          status: "ACTIVE",
          OR: [
            ...(course.code ? [{ title: { contains: course.code, mode: "insensitive" as const } }] : []),
            { title: { contains: course.name, mode: "insensitive" as const } },
          ],
        },
      }),
      prisma.event.count({
        where: {
          userId,
          courseId: id,
          startAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    let taskTotal = 0;
    for (const group of taskGroups) {
      byStatus[group.status] = group._count._all;
      taskTotal += group._count._all;
    }
    const taskCompleted = byStatus.COMPLETED ?? 0;

    const scored = grades.filter(
      (g) => g.score !== null && g.maxScore !== null && g.maxScore > 0,
    );
    const ratios = scored.map((g) => ((g.score as number) / (g.maxScore as number)) * 100);
    const weighted = scored.filter((g) => g.weight !== null && g.weight > 0);
    const weightTotal = weighted.reduce((s, g) => s + (g.weight as number), 0);
    const gradeAverage =
      ratios.length === 0
        ? null
        : weightTotal > 0
          ? Math.round(
              weighted.reduce((s, g) => s + ((g.score as number) / (g.maxScore as number)) * 100 * (g.weight as number), 0) /
                weightTotal,
            )
          : Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length);

    return {
      course: {
        id: course.id,
        name: course.name,
        code: course.code,
        status: course.status,
        credits: course.credits,
        semesterId: course.semesterId,
      },
      tasks: {
        total: taskTotal,
        completed: taskCompleted,
        open: openTaskCount,
        overdue: overdueCount,
        progress: taskTotal > 0 ? Math.round((taskCompleted / taskTotal) * 100) : null,
        byStatus,
      },
      events: {
        upcoming: upcomingEvents.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt ? e.endAt.toISOString() : null,
          location: e.location,
        })),
        examCount,
      },
      nextExam: nextExam
        ? {
            id: nextExam.id,
            title: nextExam.title,
            startAt: nextExam.startAt.toISOString(),
            location: nextExam.location,
          }
        : null,
      notes: { total: noteCount },
      resources: { total: resourceCount },
      grades: {
        total: grades.length,
        scored: scored.length,
        average: gradeAverage,
        recent: grades.slice(0, 5).map((g) => ({
          id: g.id,
          title: g.title,
          score: g.score,
          maxScore: g.maxScore,
          weight: g.weight,
          type: g.type,
          recordedAt: g.recordedAt.toISOString(),
        })),
      },
      study: {
        sessions: studyAgg._count._all,
        totalMinutes: studyAgg._sum.durationMinutes ?? 0,
      },
      goals: { relatedActive: goalCount },
      eventsToday: todayEventCount,
    };
  },
};

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapCourse(record: {
  id: string;
  code: string | null;
  name: string;
  credits: number | null;
  description: string | null;
  instructor: string | null;
  semesterId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  semester: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: string;
    academicYear: {
      id: string;
      name: string;
      startDate: Date;
      endDate: Date;
      status: string;
    };
  } | null;
}) {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    credits: record.credits,
    description: record.description,
    instructor: record.instructor,
    semesterId: record.semesterId,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    semester: record.semester
      ? {
          id: record.semester.id,
          name: record.semester.name,
          startDate: record.semester.startDate.toISOString(),
          endDate: record.semester.endDate.toISOString(),
          status: record.semester.status,
          academicYear: {
            id: record.semester.academicYear.id,
            name: record.semester.academicYear.name,
            startDate: record.semester.academicYear.startDate.toISOString(),
            endDate: record.semester.academicYear.endDate.toISOString(),
            status: record.semester.academicYear.status,
          },
        }
      : null,
  };
}
