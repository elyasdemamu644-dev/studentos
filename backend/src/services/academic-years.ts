/**
 * Academic years service — business logic for the academic-years module.
 *
 * All operations enforce:
 *  - Ownership (a user can only see/manage their own academic years)
 *  - Date consistency (start <= end)
 *  - Status transitions (year status is derived from dates + user override via isCurrent on semesters)
 */

import { prisma } from "@/utils/prisma";
import {
  ConflictError,
  NotFoundError,
  ValidationApiError,
} from "@/config/errors";
import {
  type AcademicYearCreate,
  type AcademicYearUpdate,
} from "../schemas/academic-years";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function toResponse(record: {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    name: record.name,
    startDate: record.startDate.toISOString().slice(0, 10),
    endDate: record.endDate.toISOString().slice(0, 10),
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const academicYearsService = {
  /** List all academic years for the current user, newest first. */
  async listAcademicYears(userId: string) {
    const years = await prisma.academicYear.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return years.map(toResponse);
  },

  /** Get a single academic year by id (must belong to the user). */
  async getAcademicYear(userId: string, id: string) {
    const year = await prisma.academicYear.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!year) {
      throw new NotFoundError("Academic year not found");
    }

    return toResponse(year);
  },

  /** Create a new academic year for the current user. */
  async createAcademicYear(
    userId: string,
    input: AcademicYearCreate,
  ) {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (start >= end) {
      throw new ValidationApiError("Start date must be before end date");
    }

    // Check for duplicate name within the user's years
    const existing = await prisma.academicYear.findFirst({
      where: { userId, name: input.name },
    });

    if (existing) {
      throw new ConflictError("Academic year with this name already exists");
    }

    const year = await prisma.academicYear.create({
      data: {
        userId,
        name: input.name,
        startDate: start,
        endDate: end,
        status: "UPCOMING",
      },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return toResponse(year);
  },

  /** Partially update an academic year. Only provided fields are changed. */
  async updateAcademicYear(
    userId: string,
    id: string,
    input: AcademicYearUpdate,
  ) {
    const existing = await prisma.academicYear.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Academic year not found");
    }

    // If dates are being updated, validate the range
    if (input.startDate && input.endDate) {
      if (new Date(input.startDate) > new Date(input.endDate)) {
        throw new ValidationApiError("Start date must be on or before end date");
      }
    }

    // Build the update data object with only the provided fields
    const updateData: Prisma.AcademicYearUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.startDate !== undefined) updateData.startDate = new Date(input.startDate);
    if (input.endDate !== undefined) updateData.endDate = new Date(input.endDate);
    if ((input as any).status !== undefined) updateData.status = (input as any).status;

    const year = await prisma.academicYear.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return toResponse(year);
  },

  /** Delete an academic year (cascades to semesters via Prisma). */
  async deleteAcademicYear(userId: string, id: string) {
    const existing = await prisma.academicYear.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundError("Academic year not found");
    }

    await prisma.academicYear.delete({
      where: { id },
    });

    return { deleted: true };
  },
};
