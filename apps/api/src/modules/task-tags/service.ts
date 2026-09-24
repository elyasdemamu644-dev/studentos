import { prisma } from "@/lib/prisma";
import { NotFoundError, ConflictError } from "@/config/errors";
import type { CreateTaskTagInput } from "./schema";
import type { UpdateTaskTagInput } from "./schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
//
// Tags are scoped to a single task (TaskTag requires taskId), so ownership
// is enforced via the parent task. The [taskId, name] unique constraint
// prevents duplicate tags on the same task.

export const taskTagsService = {
  /** List tags on a task (task must belong to the user). */
  async list(userId: string, taskId: string) {
    await assertTaskOwnership(userId, taskId);

    const tags = await prisma.taskTag.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });
    return tags.map(mapTag);
  },

  /** Add a tag to a task. Duplicate names on the same task are rejected. */
  async create(userId: string, taskId: string, input: CreateTaskTagInput) {
    await assertTaskOwnership(userId, taskId);

    const existing = await prisma.taskTag.findUnique({
      where: { taskId_name: { taskId, name: input.name } },
    });
    if (existing) {
      throw new ConflictError(`Tag "${input.name}" already exists on this task`);
    }

    const tag = await prisma.taskTag.create({
      data: {
        taskId,
        name: input.name,
        color: input.color ?? null,
      },
    });
    return mapTag(tag);
  },

  /** Update a tag (rename/recolor). Must belong to the task + user. */
  async update(
    userId: string,
    taskId: string,
    tagId: string,
    input: UpdateTaskTagInput,
  ) {
    await assertTaskOwnership(userId, taskId);

    const existing = await prisma.taskTag.findFirst({ where: { id: tagId, taskId } });
    if (!existing) throw new NotFoundError("Tag not found");

    if (input.name !== undefined && input.name !== existing.name) {
      const dup = await prisma.taskTag.findUnique({
        where: { taskId_name: { taskId, name: input.name } },
      });
      if (dup) {
        throw new ConflictError(`Tag "${input.name}" already exists on this task`);
      }
    }

    const tag = await prisma.taskTag.update({
      where: { id: tagId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
      },
    });
    return mapTag(tag);
  },

  /** Delete a tag. Must belong to the task + user. */
  async delete(userId: string, taskId: string, tagId: string) {
    await assertTaskOwnership(userId, taskId);

    const existing = await prisma.taskTag.findFirst({ where: { id: tagId, taskId } });
    if (!existing) throw new NotFoundError("Tag not found");

    await prisma.taskTag.delete({ where: { id: tagId } });
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

// ─────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────

function mapTag(record: {
  id: string;
  taskId: string;
  name: string;
  color: string | null;
  createdAt: Date;
}) {
  return {
    id: record.id,
    taskId: record.taskId,
    name: record.name,
    color: record.color,
    createdAt: record.createdAt.toISOString(),
  };
}