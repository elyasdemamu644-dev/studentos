import { prisma } from "@/utils/prisma";
import { NotFoundError } from "@/config/errors";
import type { SubtaskListQuery } from "../schemas/subtasks";
import type { CreateSubtaskInput, UpdateSubtaskInput } from "../schemas/subtasks";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const subtasksService = {
  /** List subtasks of a task (task must belong to the user). */
  async list(userId: string, taskId: string, query: SubtaskListQuery) {
    await assertTaskOwnership(userId, taskId);

    const subtasks = await prisma.taskSubtask.findMany({
      where: { taskId, ...(query.status ? { status: query.status } : {}) },
      orderBy: { position: "asc" },
    });
    return subtasks.map(mapSubtask);
  },

  /** Create a subtask. Position defaults to the end of the list. */
  async create(userId: string, taskId: string, input: CreateSubtaskInput) {
    await assertTaskOwnership(userId, taskId);

    const position =
      input.position ??
      (await nextSubtaskPosition(taskId));

    const subtask = await prisma.taskSubtask.create({
      data: {
        taskId,
        title: input.title,
        status: input.status ?? "TODO",
        position,
        completedAt: input.status === "COMPLETED" ? new Date() : null,
      },
    });
    return mapSubtask(subtask);
  },

  /** Update a subtask (must belong to the task + user). */
  async update(
    userId: string,
    taskId: string,
    subtaskId: string,
    input: UpdateSubtaskInput,
  ) {
    await assertTaskOwnership(userId, taskId);

    const existing = await prisma.taskSubtask.findFirst({
      where: { id: subtaskId, taskId },
    });
    if (!existing) throw new NotFoundError("Subtask not found");

    const nextStatus = input.status ?? existing.status;
    const completedAt =
      nextStatus === "COMPLETED"
        ? existing.completedAt ?? new Date()
        : null;

    const subtask = await prisma.taskSubtask.update({
      where: { id: subtaskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.completedAt !== undefined && {
          completedAt: input.completedAt ? new Date(input.completedAt) : null,
        }),
        ...(input.completedAt === undefined && { completedAt }),
      },
    });
    return mapSubtask(subtask);
  },

  /** Delete a subtask (must belong to the task + user). */
  async delete(userId: string, taskId: string, subtaskId: string) {
    await assertTaskOwnership(userId, taskId);

    const existing = await prisma.taskSubtask.findFirst({
      where: { id: subtaskId, taskId },
    });
    if (!existing) throw new NotFoundError("Subtask not found");

    await prisma.taskSubtask.delete({ where: { id: subtaskId } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertTaskOwnership(userId: string, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new NotFoundError("Task not found");
}

async function nextSubtaskPosition(taskId: string): Promise<number> {
  const last = await prisma.taskSubtask.findFirst({
    where: { taskId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

// ─────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────

function mapSubtask(record: {
  id: string;
  taskId: string;
  title: string;
  status: string;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    taskId: record.taskId,
    title: record.title,
    status: record.status,
    position: record.position,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}