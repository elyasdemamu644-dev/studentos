import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "@/config/errors";
import type { Prisma } from "@prisma/client";
import {
  type Task,
  type TaskCreate,
  type TaskUpdate,
  type TaskListQuery,
} from "@/modules/tasks/schema";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function clean<T>(record: T): T {
  // Remove any Prisma metadata or undefined fields
  return JSON.parse(JSON.stringify(record));
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const tasksService = {
  /** List tasks for the current user with optional filters.
   *
   * Supports filtering by status, priority, type, courseId,
   * due date range, and full-text search. Cursor-based pagination.
   */
  async list(
    userId: string,
    query: TaskListQuery & { limit?: number; cursor?: string },
  ) {
    const {
      status,
      priority,
      type,
      courseId,
      dueBefore,
      dueAfter,
      search,
      limit = 50,
      cursor,
    } = query;

    const where: Prisma.TaskWhereInput = { userId };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (courseId) where.courseId = courseId;
    if (dueBefore) where.dueDate = { ...((where.dueDate as object) || {}), lte: new Date(dueBefore) };
    if (dueAfter) where.dueDate = { ...((where.dueDate as object) || {}), gte: new Date(dueAfter) };

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const records = await prisma.task.findMany({
      where,
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: [
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapTask),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single task by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const task = await prisma.task.findFirst({
      where: { id, userId },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    return mapTask(task);
  },

  /** Create a new task for the current user.
   *
   * If a courseId is provided, it must belong to the user.
   */
  async create(userId: string, input: TaskCreate) {
    // If courseId is provided, verify ownership
    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });

      if (!course) {
        throw new NotFoundError("Course not found");
      }
    }

    const task = await prisma.task.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? "OTHER",
        priority: input.priority ?? "MEDIUM",
        status: input.status ?? "TODO",
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        courseId: input.courseId ?? null,
      },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return mapTask(task);
  },

  /** Update a task (partial update).
   *
   * Only provided fields are changed.
   * If courseId is changed, verify the new course belongs to the user.
   */
  async update(userId: string, id: string, input: TaskUpdate) {
    const existing = await prisma.task.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Task not found");
    }

    // If courseId is being changed, verify ownership of new course
    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });

        if (!course) {
          throw new NotFoundError("Course not found");
        }
      }
    }

    const updateData: Prisma.TaskUncheckedUpdateInput = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.dueDate !== undefined) {
      updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.estimatedMinutes !== undefined) {
      updateData.estimatedMinutes = input.estimatedMinutes;
    }
    if (input.completedAt !== undefined) {
      updateData.completedAt = input.completedAt ? new Date(input.completedAt) : null;
    }
    if (input.courseId !== undefined) {
      updateData.courseId = input.courseId ?? null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return mapTask(task);
  },

  /** Mark a task as COMPLETED.
   *
   * Sets status to COMPLETED and completedAt to now.
   * This is the dedicated endpoint for task completion.
   */
  async complete(userId: string, id: string) {
    const existing = await prisma.task.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Task not found");
    }

    const task = await prisma.task.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    return mapTask(task);
  },

  /** Delete a task. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.task.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Task not found");
    }

    await prisma.task.delete({
      where: { id },
    });

    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapTask(record: {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  courseId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  course: {
    id: string;
    code: string | null;
    name: string;
  } | null;
}) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    type: record.type,
    priority: record.priority,
    status: record.status,
    dueDate: record.dueDate ? record.dueDate.toISOString() : null,
    estimatedMinutes: record.estimatedMinutes,
    courseId: record.courseId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    course: record.course
      ? {
          id: record.course.id,
          code: record.course.code,
          name: record.course.name,
        }
      : null,
  };
}
