import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationApiError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { EventListQuery, EventCreate, EventUpdate } from "./schema";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const eventsService = {
  /** List events for the current user with optional filters. */
  async list(userId: string, query: EventListQuery) {
    const { courseId, type, startFrom, startTo, limit = 50, cursor } = query;

    const where: Prisma.EventWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (type) where.type = type;
    if (startFrom || startTo) {
      where.AND = [
        ...(startFrom
          ? [
              {
                OR: [
                  { startAt: { gte: new Date(startFrom) } },
                  { endAt: { gte: new Date(startFrom) } },
                ],
              },
            ]
          : []),
        ...(startTo ? [{ startAt: { lte: new Date(startTo) } }] : []),
      ];
    }

    const records = await prisma.event.findMany({
      where,
      include: { course: { select: { id: true, code: true, name: true } } },
      orderBy: { startAt: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapEvent),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single event by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const event = await prisma.event.findFirst({
      where: { id, userId },
      include: { course: { select: { id: true, code: true, name: true } } },
    });
    if (!event) throw new NotFoundError("Event not found");
    return mapEvent(event);
  },

  /** Create an event. Validates the date range and optional course ownership. */
  async create(userId: string, input: EventCreate) {
    assertValidRange(input.startAt, input.endAt ?? null);

    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });
      if (!course) throw new NotFoundError("Course not found");
    }

    const event = await prisma.event.create({
      data: {
        userId,
        courseId: input.courseId ?? null,
        title: input.title,
        description: input.description ?? null,
        type: input.type ?? "OTHER",
        startAt: new Date(input.startAt),
        endAt: input.endAt ? new Date(input.endAt) : null,
        location: input.location ?? null,
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapEvent(event);
  },

  /** Update an event (partial). Validates ownership + date range. */
  async update(userId: string, id: string, input: EventUpdate) {
    const existing = await prisma.event.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Event not found");

    const nextStartAt = input.startAt ? new Date(input.startAt) : existing.startAt;
    const nextEndAt =
      input.endAt !== undefined
        ? input.endAt
          ? new Date(input.endAt)
          : null
        : existing.endAt;
    assertValidRange(nextStartAt, nextEndAt);

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });
        if (!course) throw new NotFoundError("Course not found");
      }
    }

    const event = await prisma.event.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.startAt !== undefined && { startAt: new Date(input.startAt) }),
        ...(input.endAt !== undefined && {
          endAt: input.endAt ? new Date(input.endAt) : null,
        }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapEvent(event);
  },

  /** Delete an event. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.event.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Event not found");

    await prisma.event.delete({ where: { id } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function assertValidRange(startAt: Date, endAt: Date | null): void {
  if (endAt && endAt.getTime() < startAt.getTime()) {
    throw new ValidationApiError("endAt must be on or after startAt");
  }
}

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapEvent(record: {
  id: string;
  courseId: string | null;
  title: string;
  description: string | null;
  type: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
  course: { id: string; code: string | null; name: string } | null;
}) {
  return {
    id: record.id,
    courseId: record.courseId,
    title: record.title,
    description: record.description,
    type: record.type,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt ? record.endAt.toISOString() : null,
    location: record.location,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    course: record.course ?? null,
  };
}