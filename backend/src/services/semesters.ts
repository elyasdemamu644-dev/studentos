import { prisma } from "@/utils/prisma";
import {
  NotFoundError,
  ValidationApiError,
} from "@/config/errors";
import type { SemesterStatus } from "../schemas/semesters";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Parse a date string, rejecting anything that is not a real calendar date. */
function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationApiError(`Invalid ${field}`);
  }
  return date;
}

/** Ensure a semester's start is strictly before its end. */
function assertOrderedRange(start: Date, end: Date): void {
  if (start >= end) {
    throw new ValidationApiError("Start date must be before end date");
  }
}

function toResponse(record: {
  id: string;
  academicYearId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    academicYearId: record.academicYearId,
    name: record.name,
    startDate: record.startDate.toISOString().slice(0, 10),
    endDate: record.endDate.toISOString().slice(0, 10),
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

const select = {
  id: true,
  academicYearId: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const semestersService = {
  /** List all semesters belonging to the current user, earliest first. */
  async listSemesters(userId: string) {
    const records = await prisma.semester.findMany({
      where: { userId },
      orderBy: { startDate: "asc" },
      select,
    });

    return records.map(toResponse);
  },

  /** Get a single semester by id (must belong to the user). */
  async getSemester(userId: string, id: string) {
    const record = await prisma.semester.findFirst({
      where: { id, userId },
      select,
    });

    if (!record) {
      throw new NotFoundError("Semester not found");
    }

    return toResponse(record);
  },

  /** Create a new semester under one of the user's academic years. */
  async createSemester(userId: string, input: {
    name: string;
    academicYearId: string;
    startDate: string;
    endDate: string;
    status?: SemesterStatus;
  }) {
    const year = await prisma.academicYear.findFirst({
      where: { id: input.academicYearId, userId },
    });

    if (!year) {
      throw new NotFoundError("Academic year not found");
    }

    const start = parseDate(input.startDate, "start date");
    const end = parseDate(input.endDate, "end date");
    assertOrderedRange(start, end);

    const record = await prisma.semester.create({
      data: {
        userId,
        academicYearId: input.academicYearId,
        name: input.name,
        startDate: start,
        endDate: end,
        status: input.status ?? "UPCOMING",
      },
      select,
    });

    return toResponse(record);
  },

  /** Partially update a semester. Only provided fields are changed. */
  async updateSemester(userId: string, id: string, input: {
    name?: string;
    startDate?: string;
    endDate?: string;
    status?: SemesterStatus;
  }) {
    const existing = await prisma.semester.findFirst({
      where: { id, userId },
      select: { id: true, startDate: true, endDate: true },
    });

    if (!existing) {
      throw new NotFoundError("Semester not found");
    }

    // Validate against the merged state so a partial update (only start or only
    // end) cannot invert the range relative to the stored value.
    const start = input.startDate !== undefined ? parseDate(input.startDate, "start date") : existing.startDate;
    const end = input.endDate !== undefined ? parseDate(input.endDate, "end date") : existing.endDate;
    assertOrderedRange(start, end);

    const record = await prisma.semester.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.startDate !== undefined && { startDate: start }),
        ...(input.endDate !== undefined && { endDate: end }),
        ...(input.status !== undefined && { status: input.status }),
      },
      select,
    });

    return toResponse(record);
  },

  /** Delete a semester. Only the owner can delete. */
  async deleteSemester(userId: string, id: string) {
    const existing = await prisma.semester.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError("Semester not found");
    }

    await prisma.semester.delete({ where: { id } });

    return { deleted: true };
  },
};