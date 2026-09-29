import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationApiError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { GradeListQuery, GradeCreate, GradeUpdate } from "./schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const gradesService = {
  /** List grades for the current user with optional course/type filters. */
  async list(userId: string, query: GradeListQuery) {
    const { courseId, type, limit = 50, cursor } = query;

    const where: Prisma.GradeWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (type) where.type = type;

    const records = await prisma.grade.findMany({
      where,
      include: { course: { select: { id: true, code: true, name: true } } },
      orderBy: { recordedAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapGrade),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single grade by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const grade = await prisma.grade.findFirst({
      where: { id, userId },
      include: { course: { select: { id: true, code: true, name: true } } },
    });
    if (!grade) throw new NotFoundError("Grade not found");
    return mapGrade(grade);
  },

  /** Create a grade. Validates numeric values and optional course ownership. */
  async create(userId: string, input: GradeCreate) {
    validateGradeNumbers(input.score, input.maxScore);

    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });
      if (!course) throw new NotFoundError("Course not found");
    }

    const grade = await prisma.grade.create({
      data: {
        userId,
        courseId: input.courseId ?? null,
        title: input.title,
        score: input.score ?? null,
        maxScore: input.maxScore ?? null,
        weight: input.weight ?? null,
        type: input.type ?? "ASSESSMENT",
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapGrade(grade);
  },

  /** Update a grade (partial). */
  async update(userId: string, id: string, input: GradeUpdate) {
    const existing = await prisma.grade.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Grade not found");

    const nextScore = input.score !== undefined ? input.score : existing.score;
    const nextMaxScore = input.maxScore !== undefined ? input.maxScore : existing.maxScore;
    validateGradeNumbers(nextScore, nextMaxScore);

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });
        if (!course) throw new NotFoundError("Course not found");
      }
    }

    const grade = await prisma.grade.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.score !== undefined && { score: input.score }),
        ...(input.maxScore !== undefined && { maxScore: input.maxScore }),
        ...(input.weight !== undefined && { weight: input.weight }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.recordedAt !== undefined && { recordedAt: new Date(input.recordedAt) }),
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapGrade(grade);
  },

  /** Delete a grade. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.grade.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Grade not found");

    await prisma.grade.delete({ where: { id } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function validateGradeNumbers(score?: number | null, maxScore?: number | null): void {
  if (
    score !== undefined &&
    score !== null &&
    maxScore !== undefined &&
    maxScore !== null &&
    score > maxScore
  ) {
    throw new ValidationApiError("score cannot be greater than maxScore");
  }
}

// ─────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────

function mapGrade(record: {
  id: string;
  courseId: string | null;
  title: string;
  score: number | null;
  maxScore: number | null;
  weight: number | null;
  type: string;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  course: { id: string; code: string | null; name: string } | null;
}) {
  return {
    id: record.id,
    courseId: record.courseId,
    title: record.title,
    score: record.score,
    maxScore: record.maxScore,
    weight: record.weight,
    type: record.type,
    recordedAt: record.recordedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    course: record.course ?? null,
  };
}