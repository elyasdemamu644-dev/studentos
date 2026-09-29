import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { NoteListQuery, NoteCreate, NoteUpdate } from "./schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const notesService = {
  /** List notes for the current user with optional course/search filters. */
  async list(userId: string, query: NoteListQuery) {
    const { courseId, search, limit = 50, cursor } = query;

    const where: Prisma.NoteWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { content: { contains: search } },
      ];
    }

    const records = await prisma.note.findMany({
      where,
      include: { course: { select: { id: true, code: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapNote),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single note by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const note = await prisma.note.findFirst({
      where: { id, userId },
      include: { course: { select: { id: true, code: true, name: true } } },
    });
    if (!note) throw new NotFoundError("Note not found");
    return mapNote(note);
  },

  /** Create a note. Validates the optional course belongs to the user. */
  async create(userId: string, input: NoteCreate) {
    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });
      if (!course) throw new NotFoundError("Course not found");
    }

    const note = await prisma.note.create({
      data: {
        userId,
        courseId: input.courseId ?? null,
        title: input.title,
        content: input.content,
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapNote(note);
  },

  /** Update a note (partial). Validates ownership + course ownership. */
  async update(userId: string, id: string, input: NoteUpdate) {
    const existing = await prisma.note.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Note not found");

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });
        if (!course) throw new NotFoundError("Course not found");
      }
    }

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.content !== undefined && { content: input.content }),
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapNote(note);
  },

  /** Delete a note. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.note.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Note not found");

    await prisma.note.delete({ where: { id } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapNote(record: {
  id: string;
  courseId: string | null;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  course: { id: string; code: string | null; name: string } | null;
}) {
  return {
    id: record.id,
    courseId: record.courseId,
    title: record.title,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    course: record.course ?? null,
  };
}