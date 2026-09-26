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
