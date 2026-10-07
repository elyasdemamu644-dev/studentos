import { prisma } from "@/utils/prisma";
import { NotFoundError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type {
  GoalListQuery,
  GoalCreate,
  GoalUpdate,
  MilestoneCreate,
  MilestoneUpdate,
} from "../schemas/goals";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const goalsService = {
  // ── Goals ──────────────────────────────────

  /** List goals for the current user, optionally filtered by status. */
  async list(userId: string, query: GoalListQuery) {
    const { status, limit = 50, cursor } = query;

    const where: Prisma.GoalWhereInput = { userId };
    if (status) where.status = status;

    const records = await prisma.goal.findMany({
      where,
      include: { milestones: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapGoal),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single goal by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const goal = await prisma.goal.findFirst({
      where: { id, userId },
      include: { milestones: { orderBy: { position: "asc" } } },
    });
    if (!goal) throw new NotFoundError("Goal not found");
    return mapGoal(goal);
  },

  /** Create a goal. */
  async create(userId: string, input: GoalCreate) {
    const goal = await prisma.goal.create({
      data: {
        userId,
        title: input.title,
        description: input.description ?? null,
        deadline: input.deadline ? new Date(input.deadline) : null,
        status: input.status ?? "ACTIVE",
        progress: 0,
      },
      include: { milestones: true },
    });
    return mapGoal(goal);
  },

  /** Update a goal (partial). */
  async update(userId: string, id: string, input: GoalUpdate) {
    const existing = await prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Goal not found");

    const goal = await prisma.goal.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.deadline !== undefined && {
          deadline: input.deadline ? new Date(input.deadline) : null,
        }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.progress !== undefined && { progress: input.progress }),
      },
      include: { milestones: { orderBy: { position: "asc" } } },
    });
    return mapGoal(goal);
  },

  /** Delete a goal (cascades to its milestones). */
  async delete(userId: string, id: string) {
    const existing = await prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Goal not found");

    await prisma.goal.delete({ where: { id } });
    return { deleted: true };
  },

  // ── Milestones ─────────────────────────────

  /** List milestones of a goal (goal must belong to the user). */
  async listMilestones(userId: string, goalId: string) {
    await assertGoalOwnership(userId, goalId);

    const milestones = await prisma.goalMilestone.findMany({
      where: { goalId },
      orderBy: { position: "asc" },
    });
    return milestones.map(mapMilestone);
  },

  /** Create a milestone on a goal. Defaults position to the end of the list. */
  async createMilestone(userId: string, goalId: string, input: MilestoneCreate) {
    await assertGoalOwnership(userId, goalId);

    const position =
      input.position ??
      (await nextMilestonePosition(goalId));

    const milestone = await prisma.goalMilestone.create({
      data: {
        goalId,
        title: input.title,
        status: input.status ?? "TODO",
        position,
        completedAt: input.status === "COMPLETED" ? new Date() : null,
      },
    });
    return mapMilestone(milestone);
  },

  /** Update a milestone (must belong to the goal + user). */
  async updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    input: MilestoneUpdate,
  ) {
    await assertGoalOwnership(userId, goalId);

    const existing = await prisma.goalMilestone.findFirst({
      where: { id: milestoneId, goalId },
    });
    if (!existing) throw new NotFoundError("Milestone not found");

    const nextStatus = input.status ?? existing.status;
    const completedAt =
      nextStatus === "COMPLETED"
        ? existing.completedAt ?? new Date()
        : null;

    const milestone = await prisma.goalMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.completedAt !== undefined && {
          completedAt: input.completedAt ? new Date(input.completedAt) : null,
        }),
        // Keep completedAt consistent with status transitions.
        ...(input.completedAt === undefined && { completedAt }),
      },
    });
    return mapMilestone(milestone);
  },

  /** Delete a milestone (must belong to the goal + user). */
  async deleteMilestone(userId: string, goalId: string, milestoneId: string) {
    await assertGoalOwnership(userId, goalId);

    const existing = await prisma.goalMilestone.findFirst({
      where: { id: milestoneId, goalId },
    });
    if (!existing) throw new NotFoundError("Milestone not found");

    await prisma.goalMilestone.delete({ where: { id: milestoneId } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertGoalOwnership(userId: string, goalId: string): Promise<void> {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new NotFoundError("Goal not found");
}

async function nextMilestonePosition(goalId: string): Promise<number> {
  const last = await prisma.goalMilestone.findFirst({
    where: { goalId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

// ─────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────

function mapGoal(record: {
  id: string;
  title: string;
  description: string | null;
  deadline: Date | null;
  status: string;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  milestones: Array<{
    id: string;
    goalId: string;
    title: string;
    status: string;
    position: number;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    deadline: record.deadline ? record.deadline.toISOString() : null,
    status: record.status,
    progress: record.progress,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    milestones: record.milestones.map(mapMilestone),
  };
}

function mapMilestone(record: {
  id: string;
  goalId: string;
  title: string;
  status: string;
  position: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    goalId: record.goalId,
    title: record.title,
    status: record.status,
    position: record.position,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}